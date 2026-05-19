"""Fruit Game server — serves game files, leaderboard API, and auth."""
import logging
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import desc, func
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from jose import jwt, JWTError

from database import SessionLocal, init_db, get_db
from models import Score, User, VisitLog

# ─── Logging ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    stream=sys.stdout,
)
logger = logging.getLogger('fruitgame')

# ─── Auth Config ─────────────────────────────────────────────────────────────
SECRET_KEY = "fruit-game-jwt-secret-20240519"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 7 * 24 * 60  # 7 days

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def create_token(username: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": username, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


# ─── Seed Data ───────────────────────────────────────────────────────────────

def seed_sample_scores():
    """Add sample scores so the leaderboard isn't empty."""
    db = SessionLocal()
    try:
        if db.query(Score).count() == 0:
            import random
            names = [
                ("肝帝小杨", 3420), ("CodeMaster", 2980),
                ("快乐西瓜", 2810), ("LinuxUser", 2550),
                ("水果大亨", 2320), ("果果达人", 2100),
                ("甜甜圈", 1880), ("瓜瓜乐", 1650),
                ("小萌新", 1200), ("新手玩家", 780),
            ]
            for name, score in names:
                db.add(Score(
                    player_name=name,
                    score=score,
                    duration=random.randint(60, 600),
                    max_fruit=random.randint(6, 11),
                    merges=score // 30,
                    created_at=datetime.utcnow(),
                ))
            db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_sample_scores()
    yield


app = FastAPI(title="合成大西瓜", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

# ─── Request Logging Middleware ──────────────────────────────────────────

def _log_visit(request: Request, real_ip: str):
    """Persist visit info to database."""
    try:
        db = SessionLocal()
        db.add(VisitLog(
            ip_address=real_ip,
            user_agent=request.headers.get("user-agent", "")[:500],
            path=str(request.url.path)[:200],
            referer=request.headers.get("referer", "")[:500],
        ))
        db.commit()
    except Exception:
        pass
    finally:
        db.close()


@app.middleware("http")
async def log_requests(request: Request, call_next):
    ip = request.client.host if request.client else "unknown"
    via = request.headers.get("x-forwarded-for", "")
    real_ip = via.split(",")[0].strip() if via else ip
    start = time.time()
    response = await call_next(request)
    ms = int((time.time() - start) * 1000)
    t = datetime.utcnow().strftime("%H:%M:%S")
    logger.info(f"[{t}] {real_ip:15s} {request.method:6s} {request.url.path:25s} {response.status_code} ({ms}ms)")
    # Log page visits to database (skip static files and API calls to reduce noise)
    if request.method == "GET" and not request.url.path.startswith(("/static", "/api")):
        _log_visit(request, real_ip)
    return response


# ─── Schemas ───────────────────────────────────────────────────────────────

class ScoreSubmit(BaseModel):
    player_name: str = Field(..., min_length=1, max_length=30)
    score: int = Field(..., ge=0)
    duration: int = Field(default=0, ge=0)
    max_fruit: int = Field(default=0, ge=0)
    merges: int = Field(default=0, ge=0)


class AuthRegister(BaseModel):
    username: str = Field(..., min_length=1, max_length=30)
    password: str = Field(..., min_length=6, max_length=15)


class AuthLogin(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class AuthChangePassword(BaseModel):
    old_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6, max_length=15)


# ─── API ───────────────────────────────────────────────────────────────────

@app.post("/api/score")
def submit_score(body: ScoreSubmit, request: Request, db: Session = Depends(get_db)):
    """Submit a game score. Only saves if it beats the player's personal best."""
    if body.score <= 0:
        raise HTTPException(status_code=400, detail="Score must be > 0")

    player_name = body.player_name.strip()[:30]

    # Get client IP
    ip = request.client.host if request.client else "unknown"
    via = request.headers.get("x-forwarded-for", "")
    client_ip = via.split(",")[0].strip() if via else ip

    # Check existing personal best
    existing_best = (
        db.query(func.max(Score.score))
        .filter(Score.player_name == player_name)
        .scalar()
        or 0
    )

    if body.score > existing_best:
        record = Score(
            player_name=player_name,
            score=body.score,
            duration=body.duration,
            max_fruit=body.max_fruit,
            merges=body.merges,
            ip_address=client_ip,
        )
        db.add(record)
        db.commit()
        saved_id = record.id
        logger.info(f"  ⇨ NEW BEST: {player_name} = {body.score}pts [{client_ip}]")
    else:
        saved_id = 0

    # Rank & percentile (based on best score per player, matching leaderboard)
    subq = (
        db.query(
            Score.player_name,
            func.max(Score.score).label("best_score"),
        )
        .group_by(Score.player_name)
        .subquery()
    )
    rank = db.query(subq).filter(subq.c.best_score > body.score).count() + 1
    total = db.query(subq).count()
    beaten_pct = round((total - rank) / max(total, 1) * 100)

    return {
        "id": saved_id,
        "rank": rank,
        "total": total,
        "beaten_pct": beaten_pct,
        "personal_best": max(existing_best, body.score),
    }


# ─── Auth ────────────────────────────────────────────────────────────────────

@app.post("/api/register")
def register(body: AuthRegister, db: Session = Depends(get_db)):
    """Register a new user account."""
    username = body.username.strip()
    if not username or len(username) > 30:
        raise HTTPException(status_code=400, detail="用户名长度需在1-30位之间")

    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")

    user = User(username=username, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()

    token = create_token(username)
    logger.info(f"  ⇨ NEW USER: {username}")
    return {"token": token, "username": username}


@app.post("/api/login")
def login(body: AuthLogin, db: Session = Depends(get_db)):
    """Log in with existing credentials."""
    username = body.username.strip()
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    token = create_token(username)
    logger.info(f"  ⇨ LOGIN: {username}")
    return {"token": token, "username": username}


@app.get("/api/verify")
def verify(token: str = Query(...)):
    """Verify a JWT token and return the username."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="无效的令牌")
        return {"valid": True, "username": username}
    except JWTError:
        raise HTTPException(status_code=401, detail="无效的令牌")


def get_user_from_token(request: Request, db: Session) -> User:
    """Extract Bearer token from Authorization header and return the user."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未提供令牌")
    try:
        payload = jwt.decode(auth[7:], SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="无效的令牌")
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(status_code=401, detail="用户不存在")
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="无效的令牌")


@app.post("/api/change-password")
def change_password(body: AuthChangePassword, request: Request, db: Session = Depends(get_db)):
    """Change password for the authenticated user."""
    user = get_user_from_token(request, db)
    if not verify_password(body.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码错误")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    logger.info(f"  ⇨ PASSWORD CHANGED: {user.username}")
    return {"ok": True}


@app.post("/api/reset-all-passwords")
def reset_all_passwords(db: Session = Depends(get_db)):
    """Reset all users' password to '123456' for re-login."""
    count = 0
    for user in db.query(User).all():
        user.password_hash = hash_password("123456")
        count += 1
    db.commit()
    logger.info(f"  ⇨ RESET ALL PASSWORDS: {count} users")
    return {"ok": True, "count": count}


# ─── Leaderboard ─────────────────────────────────────────────────────────────

@app.get("/api/leaderboard")
def get_leaderboard(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Return best score per player (top scores, one per player)."""
    # Subquery: best score per player
    subq = (
        db.query(
            Score.player_name,
            func.max(Score.score).label("best_score"),
            func.max(Score.id).label("best_id"),
        )
        .group_by(Score.player_name)
        .subquery()
    )

    best_records = (
        db.query(Score)
        .join(subq, Score.id == subq.c.best_id)
        .order_by(desc(Score.score))
        .limit(limit)
        .all()
    )

    total_players = db.query(Score.player_name).distinct().count()

    return {
        "total_players": total_players,
        "scores": [
            {
                "rank": i + 1,
                "player_name": s.player_name,
                "score": s.score,
                "duration": s.duration,
                "max_fruit": s.max_fruit,
                "date": s.created_at.strftime("%Y-%m-%d") if s.created_at else "-",
            }
            for i, s in enumerate(best_records)
        ],
    }


@app.get("/api/player-best")
def get_player_best(
    name: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    """Return a player's personal best score."""
    best = (
        db.query(func.max(Score.score))
        .filter(Score.player_name == name)
        .scalar()
    )
    total = db.query(Score.player_name).distinct().count()
    rank = 0
    if best:
        rank = db.query(Score.player_name.distinct()).filter(
            Score.score > best
        ).count() + 1
    return {
        "player_name": name,
        "best_score": best or 0,
        "rank": rank,
        "total_players": total,
    }


# ─── Pages ─────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse("static/index.html")

@app.get("/admin")
def admin_panel(db: Session = Depends(get_db)):
    """Simple admin panel showing all scores with IPs."""
    records = db.query(Score).order_by(desc(Score.id)).limit(100).all()
    rows = "".join(
        f"<tr><td>{r.id}</td><td>{r.player_name}</td><td class='sc'>{r.score}</td>"
        f"<td>{r.duration}s</td><td class='ip'>{r.ip_address or '-'}</td>"
        f"<td>{r.created_at.strftime('%m-%d %H:%M') if r.created_at else '-'}</td></tr>"
        for r in records
    )
    return HTMLResponse(f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Admin - 合成大西瓜</title>
<style>
body {{ font: 14px/1.5 -apple-system, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 20px; }}
h1 {{ color: #FF6B35; font-size: 22px; }}
table {{ border-collapse: collapse; width: 100%; max-width: 800px; margin-top: 12px; }}
th {{ text-align: left; padding: 8px; border-bottom: 2px solid #FF6B35; color: #FF6B35; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }}
td {{ padding: 6px 8px; border-bottom: 1px solid #2a2a3e; }}
tr:hover td {{ background: rgba(255,107,53,0.06); }}
.ip {{ color: #7CB342; font-family: monospace; font-size: 13px; }}
.sc {{ color: #FFD700; font-weight: 700; }}
.cnt {{ margin: 10px 0; color: #666; font-size: 13px; }}
</style></head><body>
<h1>🍉 合成大西瓜 · 管理后台</h1>
<nav><a href="/admin" style="color:#FF6B35;margin-right:16px;">分数记录</a> <a href="/admin/visits" style="color:#FF6B35;">访问记录</a></nav>
<div class="cnt">{len(records)} 条记录 | <a href="/admin" style="color:#FF6B35;">刷新</a></div>
<table><thead><tr><th>ID</th><th>玩家</th><th>分数</th><th>用时</th><th>IP</th><th>时间</th></tr></thead>
<tbody>{rows}</tbody></table>
<script>setTimeout(()=>location.reload(),30000)</script>
</body></html>""")

@app.get("/admin/visits")
def admin_visits(db: Session = Depends(get_db)):
    """Admin page showing all visit logs with IPs."""
    records = db.query(VisitLog).order_by(desc(VisitLog.id)).limit(200).all()
    rows = "".join(
        f"<tr><td>{r.id}</td><td class='ip'>{r.ip_address}</td>"
        f"<td style='color:#aaa;font-size:13px;max-width:300px;overflow:hidden;text-overflow:ellipsis;'>{r.path}</td>"
        f"<td style='color:#888;font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;'>{r.user_agent[:60]}</td>"
        f"<td style='color:#666;font-size:12px;'>{r.created_at.strftime('%m-%d %H:%M') if r.created_at else '-'}</td></tr>"
        for r in records
    )
    return HTMLResponse(f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Visits - 合成大西瓜</title>
<style>
body {{ font: 14px/1.5 -apple-system, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 20px; }}
h1 {{ color: #FF6B35; font-size: 22px; }}
nav a {{ color: #FF6B35; margin-right: 16px; text-decoration: none; }}
nav a:hover {{ text-decoration: underline; }}
table {{ border-collapse: collapse; width: 100%; max-width: 1000px; margin-top: 12px; }}
th {{ text-align: left; padding: 8px; border-bottom: 2px solid #FF6B35; color: #FF6B35; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }}
td {{ padding: 6px 8px; border-bottom: 1px solid #2a2a3e; }}
tr:hover td {{ background: rgba(255,107,53,0.06); }}
.ip {{ color: #7CB342; font-family: monospace; font-size: 13px; }}
.cnt {{ margin: 10px 0; color: #666; font-size: 13px; }}
</style></head><body>
<h1>🍉 合成大西瓜 · 访问记录</h1>
<nav><a href="/admin">分数记录</a> <a href="/admin/visits">访问记录</a></nav>
<div class="cnt">{len(records)} 条记录 | <a href="/admin/visits" style="color:#FF6B35;">刷新</a></div>
<table><thead><tr><th>ID</th><th>IP</th><th>路径</th><th>UA</th><th>时间</th></tr></thead>
<tbody>{rows}</tbody></table>
<script>setTimeout(()=>location.reload(),30000)</script>
</body></html>""")
