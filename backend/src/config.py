from pydantic_settings import BaseSettings
from pydantic import model_validator


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/fsm"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = ""
    access_token_ttl: int = 86400
    mobile_access_token_ttl: int = 900
    device_session_ttl_days: int = 730
    mailbox_email: str = ""
    mailbox_password: str = ""
    mailbox_imap_server: str = "imap.timeweb.ru"
    mailbox_imap_port: int = 993
    smtp_server: str = "smtp.timeweb.ru"
    smtp_port: int = 465
    dadata_api_key: str = ""

    @model_validator(mode="after")
    def validate_secret_key(self):
        if not self.secret_key:
            raise ValueError("SECRET_KEY is required — set it in .env")
        return self

    class Config:
        env_file = ".env"
        extra = "allow"


settings = Settings()
