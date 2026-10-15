import re

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: EmailStr

    class Config:
        from_attributes = True


class UsernameUpdate(BaseModel):
    username: str = Field(min_length=3, max_length=32)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]{3,32}", value):
            raise ValueError(
                "Username must be 3-32 characters and contain only "
                "letters, numbers, dots, underscores or hyphens."
            )
        return value
