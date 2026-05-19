"""Score and User models for the fruit game."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime
from database import Base


class Score(Base):
    __tablename__ = "scores"

    id = Column(Integer, primary_key=True, index=True)
    player_name = Column(String(30), nullable=False)
    score = Column(Integer, nullable=False, default=0)
    duration = Column(Integer, nullable=False, default=0)
    max_fruit = Column(Integer, nullable=False, default=0)
    merges = Column(Integer, nullable=False, default=0)
    ip_address = Column(String(45), nullable=False, default='')
    created_at = Column(DateTime, default=datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(30), unique=True, nullable=False, index=True)
    password_hash = Column(String(128), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class VisitLog(Base):
    __tablename__ = "visit_logs"

    id = Column(Integer, primary_key=True, index=True)
    ip_address = Column(String(45), nullable=False, default='')
    user_agent = Column(String(500), nullable=False, default='')
    path = Column(String(200), nullable=False, default='/')
    referer = Column(String(500), nullable=False, default='')
    created_at = Column(DateTime, default=datetime.utcnow)
