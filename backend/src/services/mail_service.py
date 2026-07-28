import imaplib
import smtplib
import logging
import email
from email.header import decode_header
from email.mime.text import MIMEText
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select, text
from fastapi.concurrency import run_in_threadpool
from src.models.mailbox import MailboxConfig
from src.models.customer import Customer
from src.models.equipment import AssetLocation
from src.models.ticket import Ticket
from src.models.user import User, UserRole
from src.config import settings

logger = logging.getLogger(__name__)
MAIL_BATCH_LIMIT = 100


class MailService:
    @staticmethod
    async def send_email(to: str, subject: str, body: str):
        """Отправка email через SMTP."""
        try:
            msg = MIMEText(body, 'plain', 'utf-8')
            msg['Subject'] = subject
            msg['From'] = settings.mailbox_email
            msg['To'] = to

            def _send():
                with smtplib.SMTP_SSL(settings.smtp_server, settings.smtp_port) as s:
                    s.login(settings.mailbox_email, settings.mailbox_password)
                    s.send_message(msg)

            await run_in_threadpool(_send)
            return True
        except Exception as e:
            logger.error(f"Ошибка отправки email на {to}: {e}")
            return False

    @staticmethod
    async def notify_engineer_assigned(ticket: Ticket, engineer: User, db: AsyncSession):
        """Уведомление инженеру о назначении заявки."""
        subject = f"Вам назначена заявка №{ticket.number}"
        body = (
            f"Заявка №{ticket.number}\n"
            f"Тема: {ticket.subject}\n"
            f"Приоритет: {ticket.priority}\n\n"
            f"Заказчик: {ticket.customer.name if ticket.customer else '—'}\n"
            f"Объект: {ticket.location.name if ticket.location else '—'}\n\n"
            f"Откройте заявку в HubDesk для подробностей."
        )
        if engineer.email:
            await MailService.send_email(engineer.email, subject, body)

    @staticmethod
    async def notify_creator_accepted(ticket: Ticket, engineer: User, creator: User):
        """Уведомление создателю заявки о принятии инженером."""
        subject = f"Инженер принял заявку №{ticket.number}"
        body = (
            f"Заявка №{ticket.number} «{ticket.subject}»\n\n"
            f"Инженер {engineer.name} принял заявку в работу.\n"
            f"Статус: ACCEPTED\n"
            f"Время: {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        )
        if creator.email:
            await MailService.send_email(creator.email, subject, body)
    @staticmethod
    async def fetch_and_create_tickets(db: AsyncSession):
        lock_result = await db.execute(text("SELECT pg_try_advisory_xact_lock(43)"))
        if not lock_result.scalar():
            await db.rollback()
            logger.info("Проверка почты уже выполняется другим процессом")
            return 0

        cfg_result = await db.execute(select(MailboxConfig).limit(1))
        cfg = cfg_result.scalar_one_or_none()
        email_addr = settings.mailbox_email or (cfg.email if cfg else "")
        password = settings.mailbox_password
        imap_server = settings.mailbox_imap_server or (cfg.imap_server if cfg else "imap.timeweb.ru")
        imap_port = settings.mailbox_imap_port or (cfg.imap_port if cfg else 993)

        if not cfg or not cfg.enabled or not email_addr or not password:
            return 0

        def _fetch_uids():
            mail = imaplib.IMAP4_SSL(imap_server, imap_port)
            mail.login(email_addr, password)
            mail.select(cfg.folder)
            if cfg.last_uid is None:
                status, data = mail.uid('search', None, 'ALL')
                if status != 'OK':
                    return [], mail, None
                existing_uids = data[0].split() if data[0] else []
                baseline_uid = existing_uids[-1].decode() if existing_uids else "0"
                return [], mail, baseline_uid
            search_criteria = f'(UID {int(cfg.last_uid) + 1}:*)'
            status, data = mail.uid('search', None, search_criteria)
            if status != 'OK' or not data[0]:
                return [], mail, None
            uid_list = data[0].split()[:MAIL_BATCH_LIMIT]
            return uid_list, mail, None

        def _fetch_one(mail, uid):
            status, msg_data = mail.uid('fetch', uid, '(RFC822)')
            if status != 'OK':
                return None
            return msg_data[0][1]

        mail = None
        try:
            uid_list, mail, baseline_uid = await run_in_threadpool(_fetch_uids)
            if not uid_list:
                if baseline_uid is not None:
                    cfg.last_uid = baseline_uid
                cfg.last_check_at = datetime.utcnow()
                await db.commit()
                return 0

            new_last_uid = cfg.last_uid
            created = 0

            for uid in uid_list:
                uid_str = uid.decode()
                if cfg.last_uid and int(uid_str) <= int(cfg.last_uid):
                    continue

                raw_email = await run_in_threadpool(_fetch_one, mail, uid)
                if raw_email is None:
                    logger.warning("Не удалось получить письмо UID %s; обработка остановлена для повторной попытки", uid_str)
                    break

                try:
                    async with db.begin_nested():
                        msg = email.message_from_bytes(raw_email)
                        subject = MailService._decode_header(msg['Subject'] or 'Без темы')
                        body = MailService._get_body(msg)
                        sender = MailService._parse_sender(msg['From'] or '')

                        customer = await MailService._find_customer(db, sender)
                        if not customer:
                            logger.warning(
                                "Пропущен email от неизвестного отправителя: %s (ящик %s)",
                                sender, cfg.email,
                            )
                            new_last_uid = uid_str
                            continue

                        loc_result = await db.execute(
                            select(AssetLocation)
                            .where(AssetLocation.customer_id == customer.id)
                            .order_by(AssetLocation.id)
                            .limit(1)
                        )
                        default_loc = loc_result.scalar_one_or_none()
                        if not default_loc:
                            logger.warning(
                                "Пропущен email от %s: у заказчика %s нет объекта",
                                sender, customer.id,
                            )
                            new_last_uid = uid_str
                            continue

                        from src.services.ticket_service import TicketService
                        svc = TicketService(db)
                        await svc.create({
                            "subject": subject[:500],
                            "body": f"От: {sender}\n\n{body}"[:5000],
                            "customer_id": customer.id,
                            "location_id": default_loc.id,
                            "source_description": f"Email от {sender}",
                        })
                        created += 1
                except Exception:
                    logger.exception("Ошибка обработки письма UID %s; письмо пропущено", uid_str)

                new_last_uid = uid_str

            if new_last_uid and new_last_uid != cfg.last_uid:
                cfg.last_uid = new_last_uid
            cfg.last_check_at = datetime.utcnow()
            await db.commit()

            if created > 0:
                try:
                    log_path = "/tmp/email_history.log"
                    with open(log_path, "a") as f:
                        f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Почта — создано {created} заявок из ящика {cfg.email}\n")
                except:
                    pass

            return created
        except Exception as e:
            try:
                await db.rollback()
                cfg_result2 = await db.execute(select(MailboxConfig).limit(1))
                cfg2 = cfg_result2.scalar_one_or_none()
                if cfg2:
                    cfg2.last_check_at = datetime.utcnow()
                    await db.commit()
            except:
                pass
            raise e
        finally:
            if mail:
                try:
                    await run_in_threadpool(mail.logout)
                except:
                    pass

    @staticmethod
    def _decode_header(value: str) -> str:
        parts = decode_header(value)
        result = ""
        for part, charset in parts:
            if isinstance(part, bytes):
                result += part.decode(charset or 'utf-8', errors='replace')
            else:
                result += part
        return result

    @staticmethod
    def _get_body(msg) -> str:
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                if content_type == 'text/plain':
                    payload = part.get_payload(decode=True)
                    if payload:
                        return payload.decode('utf-8', errors='replace')
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                return payload.decode('utf-8', errors='replace')
        return ""

    @staticmethod
    def _parse_sender(from_field: str) -> str:
        if '<' in from_field:
            return from_field.split('<')[1].split('>')[0].strip().lower()
        return from_field.strip().lower()

    @staticmethod
    async def _find_customer(db: AsyncSession, email_addr: str):
        from sqlalchemy import select as sa_select
        from src.models.equipment import LocationContact, AssetLocation
        email_lower = email_addr.strip().lower()
        # Search by LocationContact.email
        result = await db.execute(
            sa_select(Customer)
            .join(AssetLocation, AssetLocation.customer_id == Customer.id)
            .join(LocationContact, LocationContact.location_id == AssetLocation.id)
            .where(func.lower(LocationContact.email) == email_lower)
            .limit(1)
        )
        customer = result.scalar_one_or_none()
        if customer:
            return customer
        # Search by AssetLocation.contact_email
        result = await db.execute(
            sa_select(Customer)
            .join(AssetLocation, AssetLocation.customer_id == Customer.id)
            .where(func.lower(AssetLocation.contact_email) == email_lower)
            .limit(1)
        )
        return result.scalar_one_or_none()
