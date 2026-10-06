import pytest

from src.api.schemas import TicketCreate, TicketUpdate
from src.models.ticket import TicketType


@pytest.mark.parametrize(
    "value",
    ["pressure_test_preparation", "pressure_test_with_inspector"],
)
def test_pressure_test_types_are_accepted_by_ticket_contracts(value):
    assert TicketType(value).value == value
    assert TicketCreate(type=value).type == TicketType(value)
    assert TicketUpdate(type=value).type == TicketType(value)
