import imaplib
import email
from email.header import decode_header
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.models.mailbox import MailboxConfig
from src.models.customer import Customer
from src.models.ticket import Ticket
from src.models.equipment import AssetLocation
from src.models.user import User, UserRole
from src.config import settings


class MailService:
    @staticmethod
    async def fetch_and_create_tickets(db: AsyncSession):
        cfg_result = await db.execute(select(MailboxConfig).limit(1))
        cfg = cfg_result.scalar_one_or_none()
        email_addr = settings.mailbox_email or (cfg.email if cfg else "")
        password = settings.mailbox_password
        imap_server = settings.mailbox_imap_server or (cfg.imap_server if cfg else "imap.timeweb.ru")
        imap_port = settings.mailbox_imap_port or (cfg.imap_port if cfg else 993)

        if not cfg or not cfg.enabled or not email_addr or not password:
            return 0

        try:
            mail = imaplib.IMAP4_SSL(imap_server, imap_port)
            mail.login(email_addr, password)
            mail.select(cfg.folder)

            search_criteria = f'(UID {int(cfg.last_uid or 0) + 1}:*)' if cfg.last_uid else 'ALL'
            status, data = mail.uid('search', None, 'ALL')

            if status != 'OK' or not data[0]:
                mail.logout()
                return 0

            uid_list = data[0].split()
            if not uid_list:
                mail.logout()
                return 0

            new_last_uid = cfg.last_uid
            created = 0

            for uid in uid_list:
                uid_str = uid.decode()
                if cfg.last_uid and int(uid_str) <= int(cfg.last_uid):
                    continue

                status, msg_data = mail.uid('fetch', uid, '(RFC822)')
                if status != 'OK':
                    continue

                raw_email = msg_data[0][1]
                msg = email.message_from_bytes(raw_email)

                subject = MailService._decode_header(msg['Subject'] or 'Без темы')
                body = MailService._get_body(msg)
                sender = MailService._parse_sender(msg['From'] or '')

                customer = await MailService._find_customer(db, sender)
                customer_id = customer.id if customer else None
                if not customer_id:
                    cust_result = await db.execute(select(Customer).limit(1))
                    first_cust = cust_result.scalar_one_or_none()
                    if first_cust:
                        customer_id = first_cust.id
                    else:
                        customer = Customer(name=sender or "Email", type="company")
                        db.add(customer)
                        await db.flush()
                        customer_id = customer.id

                loc_result = await db.execute(select(AssetLocation).limit(1))
                first_loc = loc_result.scalar_one_or_none()
                location_id = first_loc.id if first_loc else None

                last_num_result = await db.execute(
                    select(Ticket.number).order_by(Ticket.number.desc()).limit(1)
                )
                last_num = last_num_result.scalar() or 999
                ticket = Ticket(
                    number=last_num + 1,
                    subject=subject[:500],
                    body=f"От: {sender}\n\n{body}"[:5000],
                    customer_id=customer_id,
                    location_id=location_id,
                    source_description=f"Email от {sender}",
                )
                db.add(ticket)

                new_last_uid = uid_str
                created += 1

            mail.logout()

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
                cfg.last_check_at = datetime.utcnow()
                await db.commit()
            except:
                pass
            raise e

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
        result = await db.execute(
            sa_select(Customer).where(Customer.name.ilike(f"%{email_addr}%"))
        )
        return result.scalar_one_or_none()
