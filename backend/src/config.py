from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/fsm"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "change-me"
    access_token_ttl: int = 604800
    mailbox_email: str = ""
    mailbox_password: str = ""
    mailbox_imap_server: str = "imap.timeweb.ru"
    mailbox_imap_port: int = 993
    smtp_server: str = "smtp.timeweb.ru"
    smtp_port: int = 465
    dadata_api_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
