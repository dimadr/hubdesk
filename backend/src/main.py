import os
from datetime import datetime, timedelta, date
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from passlib.hash import bcrypt
from .api.router import api_router
from .database import engine, Base, async_session
from .models.user import User, UserRole, UserStatus
from .models.customer import Customer
from .models.equipment import AssetLocation
from .models.ticket import Ticket, TicketStatus, TicketPriority, TicketType
from .models.warehouse import Warehouse, WarehouseType, Nomenclature, NomenclatureType, AccountingDocument, DocType, DocStatus, DocumentLine, StockBalance

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "frontend", "dist")
STATIC_DIR = os.path.join(FRONTEND_DIR, "assets") if os.path.exists(os.path.join(FRONTEND_DIR, "assets")) else None


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        from sqlalchemy import text
        new_columns = [
            ("type", "VARCHAR(50)"),
            ("site_contact_name", "VARCHAR(255)"),
            ("site_contact_phone", "VARCHAR(50)"),
            ("scheduled_start", "TIMESTAMP"),
            ("scheduled_end", "TIMESTAMP"),
            ("source_description", "VARCHAR(5000)"),
            ("archived_at", "TIMESTAMP"),
            ("contact_name", "VARCHAR(255)"),
            ("contact_phone", "VARCHAR(50)"),
            ("contact_email", "VARCHAR(255)"),
        ]
        for col_name, col_type in new_columns:
            try:
                await conn.execute(text(f"ALTER TABLE tickets ADD COLUMN {col_name} {col_type}"))
            except:
                pass

    async with async_session() as session:
        from sqlalchemy import select
        result = await session.execute(select(User).limit(1))
        if not result.scalar_one_or_none():
            session.add_all([
                User(email="admin@fsm.local", name="Админ", role=UserRole.admin,
                     password_hash=bcrypt.hash("admin123"), status=UserStatus.active),
                User(email="engineer@fsm.local", name="Иван Петров", role=UserRole.engineer,
                     password_hash=bcrypt.hash("eng123"), status=UserStatus.active),
                User(email="engineer2@fsm.local", name="Сергей Кузнецов", role=UserRole.engineer,
                     password_hash=bcrypt.hash("eng123"), status=UserStatus.active),
                User(email="engineer3@fsm.local", name="Анна Волкова", role=UserRole.engineer,
                     password_hash=bcrypt.hash("eng123"), status=UserStatus.active),
                User(email="dispatcher@fsm.local", name="Ольга Сидорова", role=UserRole.dispatcher,
                     password_hash=bcrypt.hash("disp123"), status=UserStatus.active),
                User(email="dispatcher2@fsm.local", name="Михаил Орлов", role=UserRole.dispatcher,
                     password_hash=bcrypt.hash("disp123"), status=UserStatus.active),
                User(email="storekeeper@fsm.local", name="Вера Соколова", role=UserRole.storekeeper,
                     password_hash=bcrypt.hash("stk123"), status=UserStatus.active),
                User(email="customer@fsm.local", name="Константин Заказчиков", role=UserRole.customer,
                     password_hash=bcrypt.hash("cust123"), status=UserStatus.active),
            ])
            await session.flush()

        cust_result = await session.execute(select(Customer).where(Customer.name == "ООО Техносервис").limit(1))
        if not cust_result.scalar_one_or_none():
            session.add_all([
                Customer(name="ООО Техносервис", type="company"),
                Customer(name="Гостиница Волга", type="company"),
                Customer(name="ТЦ Мегаполис", type="company"),
                Customer(name="Сеть аптек Фарма+", type="company"),
            ])
            await session.flush()

        loc_result = await session.execute(select(AssetLocation).where(AssetLocation.name == "Главный офис").limit(1))
        if not loc_result.scalar_one_or_none():
            customers = (await session.execute(select(Customer))).scalars().all()
            users = (await session.execute(select(User))).scalars().all()
            user_by_name = {u.name: u for u in users}
            cust_by_name = {c.name: c for c in customers}

            session.add_all([
                AssetLocation(
                    customer_id=cust_by_name["ООО Техносервис"].id,
                    name="Главный офис", address="ул. Ленина, 42",
                    contacts="+7 (900) 111-22-33, office@tehnoservis.ru",
                    assigned_engineer_id=user_by_name["Иван Петров"].id,
                    contract_number="ТС-2026/042", contract_valid_from=date(2026, 1, 1), contract_valid_to=date(2026, 12, 31),
                ),
                AssetLocation(
                    customer_id=cust_by_name["ООО Техносервис"].id,
                    name="Филиал на Гагарина", address="ул. Гагарина, 15, стр. 3",
                    contacts="+7 (900) 111-22-44",
                    assigned_engineer_id=user_by_name["Иван Петров"].id,
                    contract_number="ТС-2026/043", contract_valid_from=date(2026, 3, 1), contract_valid_to=date(2027, 2, 28),
                ),
                AssetLocation(
                    customer_id=cust_by_name["Гостиница Волга"].id,
                    name="Гостиница Волга — главный корпус", address="наб. Волги, 8",
                    contacts="+7 (910) 333-44-55, admin@volgahotel.ru",
                    assigned_engineer_id=user_by_name["Сергей Кузнецов"].id,
                    contract_number="ГВ-2026/11", contract_valid_from=date(2026, 2, 15), contract_valid_to=date(2027, 2, 14),
                ),
                AssetLocation(
                    customer_id=cust_by_name["Гостиница Волга"].id,
                    name="Гостиница Волга — SPA-комплекс", address="наб. Волги, 8Б",
                    contacts="+7 (910) 333-44-66",
                    assigned_engineer_id=user_by_name["Сергей Кузнецов"].id,
                    contract_number="ГВ-2026/12", contract_valid_from=date(2026, 4, 1), contract_valid_to=date(2026, 9, 30),
                ),
                AssetLocation(
                    customer_id=cust_by_name["ТЦ Мегаполис"].id,
                    name="ТЦ Мегаполис — здание А", address="пр. Строителей, 72",
                    contacts="+7 (920) 555-66-77, support@megapolis.ru",
                    assigned_engineer_id=user_by_name["Анна Волкова"].id,
                    contract_number="МГ-2025/78", contract_valid_from=date(2025, 7, 1), contract_valid_to=date(2026, 6, 30),
                ),
                AssetLocation(
                    customer_id=cust_by_name["ТЦ Мегаполис"].id,
                    name="ТЦ Мегаполис — паркинг", address="пр. Строителей, 72 стр. 10",
                    contacts="+7 (920) 555-66-88",
                    assigned_engineer_id=user_by_name["Анна Волкова"].id,
                    contract_number="МГ-2025/79", contract_valid_from=date(2025, 7, 1), contract_valid_to=date(2026, 6, 30),
                ),
                AssetLocation(
                    customer_id=cust_by_name["Сеть аптек Фарма+"].id,
                    name="Аптека №1 Центральная", address="ул. Мира, 3",
                    contacts="+7 (930) 777-88-99",
                    assigned_engineer_id=user_by_name["Иван Петров"].id,
                    contract_number="ФП-2025/15", contract_valid_from=date(2025, 11, 1), contract_valid_to=date(2026, 10, 31),
                ),
                AssetLocation(
                    customer_id=cust_by_name["Сеть аптек Фарма+"].id,
                    name="Аптека №4 Заречная", address="ул. Заречная, 21",
                    contacts="+7 (930) 777-88-00",
                    assigned_engineer_id=user_by_name["Анна Волкова"].id,
                    contract_number="ФП-2025/18", contract_valid_from=date(2025, 12, 15), contract_valid_to=date(2026, 12, 14),
                ),
            ])
            await session.flush()

        wh_result = await session.execute(select(Warehouse).limit(1))
        if not wh_result.scalar_one_or_none():
            session.add_all([
                Warehouse(name="Центральный склад", type=WarehouseType.physical),
                Warehouse(name="Резервный склад", type=WarehouseType.physical),
                Warehouse(name="Склад расходников", type=WarehouseType.physical),
                Warehouse(name="Склад инженера Иванова", type=WarehouseType.personal),
                Warehouse(name="Склад инженера Кузнецова", type=WarehouseType.personal),
                Warehouse(name="Склад инженера Волковой", type=WarehouseType.personal),
            ])
            await session.flush()

        nom_result = await session.execute(select(Nomenclature).limit(1))
        if not nom_result.scalar_one_or_none():
            session.add_all([
                Nomenclature(name="Картридж HP 106A (чёрный)", type=NomenclatureType.material, unit="шт"),
                Nomenclature(name="Кабель витая пара UTP, кат. 5e, бухта 305м", type=NomenclatureType.material, unit="бухта"),
                Nomenclature(name="Термопаста Arctic MX-6, 4г", type=NomenclatureType.material, unit="тюбик"),
                Nomenclature(name="Вентилятор 120мм Arctic P12 PWM", type=NomenclatureType.material, unit="шт"),
                Nomenclature(name="Бумага А4, 500л, SvetoCopy", type=NomenclatureType.material, unit="пачка"),
                Nomenclature(name="Блок питания 500W Chieftec", type=NomenclatureType.material, unit="шт"),
                Nomenclature(name="SSD 1TB Samsung 870 EVO", type=NomenclatureType.material, unit="шт"),
                Nomenclature(name="Монитор 24 HP EliteDisplay E24", type=NomenclatureType.product, unit="шт"),
                Nomenclature(name="Ноутбук HP ProBook 450 G10", type=NomenclatureType.product, unit="шт"),
                Nomenclature(name="ИБП APC Back-UPS 700VA", type=NomenclatureType.product, unit="шт"),
                Nomenclature(name="Выезд инженера", type=NomenclatureType.service, unit="выезд"),
                Nomenclature(name="Диагностика оборудования", type=NomenclatureType.service, unit="час"),
                Nomenclature(name="Монтаж СКС (1 порт)", type=NomenclatureType.work, unit="порт"),
                Nomenclature(name="Пусконаладка сервера", type=NomenclatureType.work, unit="шт"),
            ])
            await session.flush()

            now = datetime.utcnow()

            locations = (await session.execute(select(AssetLocation))).scalars().all()
            loc_by_name = {l.name: l for l in locations}
            users = (await session.execute(select(User))).scalars().all()
            user_by_name = {u.name: u for u in users}

            tickets = [
                Ticket(number=1001, subject="Не включается сервер в серверной", body="Сервер HP ProLiant DL380 не подаёт признаков жизни после скачка напряжения.",
                       status=TicketStatus.IN_PROGRESS,                        type=TicketType.emergency, priority=TicketPriority.critical, is_internal=False,
                       customer_id=loc_by_name["Главный офис"].customer_id, location_id=loc_by_name["Главный офис"].id,
                       assignee_id=user_by_name["Иван Петров"].id,
                       response_deadline=now + timedelta(hours=2), resolution_deadline=now + timedelta(days=1)),
                Ticket(number=1002, subject="Замена картриджа в МФУ", body="МФУ HP LaserJet в бухгалтерии печатает с полосами. Требуется замена картриджа.",
                       status=TicketStatus.ASSIGNED,                        type=TicketType.repair, priority=TicketPriority.low, is_internal=False,
                       customer_id=loc_by_name["Главный офис"].customer_id, location_id=loc_by_name["Главный офис"].id,
                       assignee_id=user_by_name["Сергей Кузнецов"].id,
                       response_deadline=now + timedelta(hours=4), resolution_deadline=now + timedelta(hours=24)),
                Ticket(number=1003, subject="Пропал интернет во всём филиале", body="С 10:00 нет доступа в сеть. Маршрутизатор MikroTik перезагружали — не помогло.",
                       status=TicketStatus.ACCEPTED,                        type=TicketType.emergency, priority=TicketPriority.critical, is_internal=False,
                       customer_id=loc_by_name["Филиал на Гагарина"].customer_id, location_id=loc_by_name["Филиал на Гагарина"].id,
                       assignee_id=user_by_name["Иван Петров"].id,
                       response_deadline=now - timedelta(hours=3), resolution_deadline=now + timedelta(hours=3)),
                Ticket(number=1004, subject="Установка нового рабочего места", body="Нужно установить ПК, монитор и подключить к сети в кабинете №14.",
                       status=TicketStatus.ASSIGNED, type=TicketType.installation, priority=TicketPriority.medium, is_internal=False,
                       customer_id=loc_by_name["Филиал на Гагарина"].customer_id, location_id=loc_by_name["Филиал на Гагарина"].id,
                       assignee_id=user_by_name["Анна Волкова"].id,
                       response_deadline=now + timedelta(hours=8), resolution_deadline=now + timedelta(days=3)),
                Ticket(number=1005, subject="Гости не могут подключиться к Wi-Fi", body="В главном корпусе гостиницы перестала работать гостевая Wi-Fi сеть. Жалобы от постояльцев.",
                       status=TicketStatus.ON_THE_WAY, type=TicketType.repair, priority=TicketPriority.high, is_internal=False,
                       customer_id=loc_by_name["Гостиница Волга — главный корпус"].customer_id, location_id=loc_by_name["Гостиница Волга — главный корпус"].id,
                       assignee_id=user_by_name["Сергей Кузнецов"].id,
                       response_deadline=now + timedelta(hours=1), resolution_deadline=now + timedelta(hours=6)),
                Ticket(number=1006, subject="Сломался турникет на входе", body="Турникет PERCo на главном входе не считывает карты. Сотрудники не могут пройти.",
                       status=TicketStatus.IN_PROGRESS, type=TicketType.repair, priority=TicketPriority.high, is_internal=False,
                       customer_id=loc_by_name["Гостиница Волга — главный корпус"].customer_id, location_id=loc_by_name["Гостиница Волга — главный корпус"].id,
                       assignee_id=user_by_name["Сергей Кузнецов"].id,
                       response_deadline=now + timedelta(hours=4), resolution_deadline=now + timedelta(hours=12)),
                Ticket(number=1007, subject="Замена термопасты на сервере видеонаблюдения", body="Плановое обслуживание. Сервер перегревается, температура CPU под 85°C.",
                       status=TicketStatus.REVIEW, type=TicketType.maintenance, priority=TicketPriority.medium, is_internal=False,
                       customer_id=loc_by_name["ТЦ Мегаполис — здание А"].customer_id, location_id=loc_by_name["ТЦ Мегаполис — здание А"].id,
                       assignee_id=user_by_name["Анна Волкова"].id,
                       response_deadline=now + timedelta(hours=24), resolution_deadline=now + timedelta(days=2)),
                Ticket(number=1008, subject="Не работают камеры на паркинге", body="4 камеры из 12 не передают картинку. Предположительно проблема с PoE-коммутатором.",
                       status=TicketStatus.ARRIVED, type=TicketType.repair, priority=TicketPriority.high, is_internal=False,
                       customer_id=loc_by_name["ТЦ Мегаполис — паркинг"].customer_id, location_id=loc_by_name["ТЦ Мегаполис — паркинг"].id,
                       assignee_id=user_by_name["Анна Волкова"].id,
                       response_deadline=now + timedelta(hours=2), resolution_deadline=now + timedelta(hours=8)),
                Ticket(number=1009, subject="Плановая проверка ИБП в серверной", body="Ежемесячная проверка всех ИБП. Замена батарей при необходимости.",
                       status=TicketStatus.COMPLETED, type=TicketType.inspection, priority=TicketPriority.low, is_internal=False,
                       customer_id=loc_by_name["ТЦ Мегаполис — здание А"].customer_id, location_id=loc_by_name["ТЦ Мегаполис — здание А"].id,
                       assignee_id=user_by_name["Анна Волкова"].id,
                       completed_at=now - timedelta(days=2),
                       response_deadline=now - timedelta(days=5), resolution_deadline=now - timedelta(days=3)),
                Ticket(number=1010, subject="Кассовый аппарат не печатает чеки", body="Касса Атол 30Ф в аптеке №1 зависла. Требуется срочный выезд — очередь покупателей.",
                       status=TicketStatus.ASSIGNED,                        type=TicketType.emergency, priority=TicketPriority.critical, is_internal=False,
                       customer_id=loc_by_name["Аптека №1 Центральная"].customer_id, location_id=loc_by_name["Аптека №1 Центральная"].id,
                       assignee_id=user_by_name["Иван Петров"].id,
                       response_deadline=now + timedelta(minutes=30), resolution_deadline=now + timedelta(hours=4)),
                Ticket(number=1011, subject="Замена жёсткого диска на рабочем ПК", body="ПК фармацевта в аптеке №4 выдаёт SMART-ошибку. Нужно заменить диск и перенести данные.",
                       status=TicketStatus.COMPLETED, type=TicketType.repair, priority=TicketPriority.medium, is_internal=False,
                       customer_id=loc_by_name["Аптека №4 Заречная"].customer_id, location_id=loc_by_name["Аптека №4 Заречная"].id,
                       assignee_id=user_by_name["Анна Волкова"].id,
                       completed_at=now - timedelta(days=5),
                       response_deadline=now - timedelta(days=6), resolution_deadline=now - timedelta(days=5)),
                Ticket(number=1012, subject="Не синхронизируется база аптеки с сервером", body="После обновления 1С база аптеки №4 не коннектится к центральному серверу.",
                       status=TicketStatus.IN_PROGRESS, type=TicketType.repair, priority=TicketPriority.high, is_internal=False,
                       customer_id=loc_by_name["Аптека №4 Заречная"].customer_id, location_id=loc_by_name["Аптека №4 Заречная"].id,
                       assignee_id=user_by_name["Сергей Кузнецов"].id,
                       response_deadline=now - timedelta(hours=12), resolution_deadline=now + timedelta(hours=12)),
                Ticket(number=1013, subject="Внутреннее: переезд серверной стойки", body="Плановая миграция оборудования в рамках реорганизации офиса.",
                       status=TicketStatus.ASSIGNED, type=TicketType.installation, priority=TicketPriority.medium, is_internal=True,
                       customer_id=loc_by_name["Главный офис"].customer_id, location_id=loc_by_name["Главный офис"].id,
                       response_deadline=now + timedelta(days=7), resolution_deadline=now + timedelta(days=14)),
                Ticket(number=1014, subject="SPA-комплекс: не греется бассейн", body="Система подогрева бассейна вышла из строя. Температура упала до 18°C.",
                       status=TicketStatus.ACCEPTED, type=TicketType.repair, priority=TicketPriority.high, is_internal=False,
                       customer_id=loc_by_name["Гостиница Волга — SPA-комплекс"].customer_id, location_id=loc_by_name["Гостиница Волга — SPA-комплекс"].id,
                       assignee_id=user_by_name["Сергей Кузнецов"].id,
                       response_deadline=now - timedelta(hours=6), resolution_deadline=now + timedelta(hours=6)),
                Ticket(number=1015, subject="Настройка почтового сервера", body="Настроить Exchange для нового филиала. Создать 15 почтовых ящиков, мигрировать старые.",
                       status=TicketStatus.COMPLETED, type=TicketType.installation, priority=TicketPriority.low, is_internal=False,
                       customer_id=loc_by_name["Филиал на Гагарина"].customer_id, location_id=loc_by_name["Филиал на Гагарина"].id,
                       assignee_id=user_by_name["Иван Петров"].id,
                       completed_at=now - timedelta(days=10),
                       response_deadline=now - timedelta(days=12), resolution_deadline=now - timedelta(days=10)),
            ]
            session.add_all(tickets)
            await session.flush()

            warehouses = (await session.execute(select(Warehouse))).scalars().all()
            wh_by_name = {w.name: w for w in warehouses}
            noms = (await session.execute(select(Nomenclature))).scalars().all()
            nom_by_name = {n.name: n for n in noms}

            doc = AccountingDocument(
                doc_type=DocType.INFLOW, status=DocStatus.ACCOUNTED,
                target_warehouse_id=wh_by_name["Центральный склад"].id,
            )
            session.add(doc)
            await session.flush()
            session.add_all([
                DocumentLine(document_id=doc.id, nomenclature_id=nom_by_name["Картридж HP 106A (чёрный)"].id, quantity=20),
                DocumentLine(document_id=doc.id, nomenclature_id=nom_by_name["Бумага А4, 500л, SvetoCopy"].id, quantity=50),
                DocumentLine(document_id=doc.id, nomenclature_id=nom_by_name["Кабель витая пара UTP, кат. 5e, бухта 305м"].id, quantity=5),
                DocumentLine(document_id=doc.id, nomenclature_id=nom_by_name["Вентилятор 120мм Arctic P12 PWM"].id, quantity=30),
                DocumentLine(document_id=doc.id, nomenclature_id=nom_by_name["SSD 1TB Samsung 870 EVO"].id, quantity=10),
                DocumentLine(document_id=doc.id, nomenclature_id=nom_by_name["Блок питания 500W Chieftec"].id, quantity=8),
                DocumentLine(document_id=doc.id, nomenclature_id=nom_by_name["Монитор 24 HP EliteDisplay E24"].id, quantity=5),
            ])
            await session.flush()

            balances = [
                StockBalance(warehouse_id=wh_by_name["Центральный склад"].id, nomenclature_id=nom_by_name["Картридж HP 106A (чёрный)"].id, quantity=20),
                StockBalance(warehouse_id=wh_by_name["Центральный склад"].id, nomenclature_id=nom_by_name["Бумага А4, 500л, SvetoCopy"].id, quantity=50),
                StockBalance(warehouse_id=wh_by_name["Центральный склад"].id, nomenclature_id=nom_by_name["Кабель витая пара UTP, кат. 5e, бухта 305м"].id, quantity=5),
                StockBalance(warehouse_id=wh_by_name["Центральный склад"].id, nomenclature_id=nom_by_name["Вентилятор 120мм Arctic P12 PWM"].id, quantity=30),
                StockBalance(warehouse_id=wh_by_name["Центральный склад"].id, nomenclature_id=nom_by_name["SSD 1TB Samsung 870 EVO"].id, quantity=10),
                StockBalance(warehouse_id=wh_by_name["Центральный склад"].id, nomenclature_id=nom_by_name["Блок питания 500W Chieftec"].id, quantity=8),
                StockBalance(warehouse_id=wh_by_name["Центральный склад"].id, nomenclature_id=nom_by_name["Монитор 24 HP EliteDisplay E24"].id, quantity=5),
                StockBalance(warehouse_id=wh_by_name["Склад инженера Иванова"].id, nomenclature_id=nom_by_name["Термопаста Arctic MX-6, 4г"].id, quantity=12),
                StockBalance(warehouse_id=wh_by_name["Склад инженера Иванова"].id, nomenclature_id=nom_by_name["Вентилятор 120мм Arctic P12 PWM"].id, quantity=4),
                StockBalance(warehouse_id=wh_by_name["Склад инженера Кузнецова"].id, nomenclature_id=nom_by_name["Кабель витая пара UTP, кат. 5e, бухта 305м"].id, quantity=2),
                StockBalance(warehouse_id=wh_by_name["Склад инженера Волковой"].id, nomenclature_id=nom_by_name["Картридж HP 106A (чёрный)"].id, quantity=5),
            ]
            session.add_all(balances)
            await session.flush()

        await session.commit()

    import asyncio as _asyncio

    async def _mail_worker():
        from src.services.mail_service import MailService
        while True:
            try:
                async with async_session() as s:
                    await MailService.fetch_and_create_tickets(s)
            except:
                pass
            await _asyncio.sleep(120)

    _mail_task = _asyncio.create_task(_mail_worker())

    yield

    _mail_task.cancel()
    try:
        await _mail_task
    except _asyncio.CancelledError:
        pass


app = FastAPI(title="FSM Platform", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}


if FRONTEND_DIR and os.path.exists(FRONTEND_DIR):
    if STATIC_DIR and os.path.exists(STATIC_DIR):
        app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")

    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        index = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.exists(index):
            return FileResponse(index)
        return {"detail": "Not Found"}

    @app.get("/")
    async def root():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
