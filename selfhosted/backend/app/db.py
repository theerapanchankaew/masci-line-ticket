from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from .config import Settings


class Base(DeclarativeBase):
    pass


settings = Settings.load()
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)
Session = sessionmaker(engine, expire_on_commit=False)


def get_db():
    with Session() as db:
        yield db
