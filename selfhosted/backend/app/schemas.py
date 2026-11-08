from typing import Literal
from pydantic import BaseModel, Field, ConfigDict


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Login(StrictModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class TicketCreate(StrictModel):
    message_ids: list[str] = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=300)
    team_id: str
    policy_id: str
    priority: int = Field(ge=1, le=4)
    rule_id: str | None = None
    reason: str = Field(min_length=1, max_length=1000)


class Versioned(StrictModel):
    version: int = Field(ge=1)


class Assignment(Versioned):
    owner_id: str | None = None


class Transfer(Versioned):
    team_id: str
    reason: str = Field(min_length=1, max_length=1000)


class Change(Versioned):
    action: Literal["start", "wait", "resume", "resolve", "close", "reopen", "cancel"]
    reason: str = Field(default="", max_length=5000)


class TextInput(StrictModel):
    text: str = Field(min_length=1, max_length=5000)


class TaskCreate(Versioned):
    title: str = Field(min_length=1, max_length=300)
    assignee_id: str
    dependencies: list[str] = Field(default_factory=list, max_length=50)
    required: bool = True
    due_at: float


class UserCreate(StrictModel):
    email: str = Field(min_length=3, max_length=200)
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=12, max_length=200)
    role: Literal["agent", "dispatcher", "admin"] = "agent"
    team_id: str | None = None
    capacity: int = Field(default=5, ge=1, le=100)


class RuleCreate(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    keywords: list[str] = Field(min_length=1, max_length=50)
    team_id: str
    policy_id: str
    priority: int = Field(ge=1, le=4)
    rank: int = Field(default=100, ge=0)


class PolicyCreate(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    config: dict


class UserUpdate(StrictModel):
    available: bool | None = None
    active: bool | None = None
    capacity: int | None = Field(default=None, ge=1, le=100)
    password: str | None = Field(default=None, min_length=12, max_length=200)


class RuleState(StrictModel):
    active: bool
