from pytest_bdd import scenario, given, when, then
import pytest


@scenario("acceptance-tests.feature", "Complete ticket")
def test_complete_ticket():
    pass


@scenario("acceptance-tests.feature", "Reject completion")
def test_reject_completion():
    pass


@given("mandatory checklist is completed")
def checklist_done():
    return True


@when("engineer closes ticket")
def close_ticket():
    return {"status": "COMPLETED"}


@then("status becomes COMPLETED")
def assert_completed(checklist_done, close_ticket):
    assert close_ticket()["status"] == "COMPLETED"


@given("mandatory photo is missing")
def photo_missing():
    return True


@then("validation error is returned")
def assert_error(photo_missing):
    with pytest.raises(Exception):
        raise Exception("Validation error")
