from abc import ABC, abstractmethod
from typing import Any, Callable, Coroutine
from .exceptions import InvalidTransitionError, GuardFailedError

GuardFn = Callable[[Any, dict[str, Any]], Coroutine[Any, Any, bool]]


class BaseFSM(ABC):
    transitions: dict[str, list[str]] = {}
    guards: dict[str, list[tuple[str, GuardFn]]] = {}

    @abstractmethod
    def get_status(self, entity: Any) -> str:
        ...

    @abstractmethod
    def set_status(self, entity: Any, target: str) -> None:
        ...

    @abstractmethod
    async def log_transition(
        self, entity: Any, from_status: str, to_status: str, user_id: int, context: dict
    ) -> None:
        ...

    def can_transition(self, current: str, target: str) -> bool:
        allowed = self.transitions.get(current, [])
        return target in allowed

    async def transition(
        self, entity: Any, target: str, user_id: int, context: dict[str, Any] | None = None,
        bypass_guards: bool = False,
    ) -> Any:
        ctx = context or {}
        current = self.get_status(entity)
        if not self.can_transition(current, target):
            raise InvalidTransitionError(current, target, getattr(entity, "id", 0))
        guard_list = self.guards.get(f"{current}->{target}", [])
        if not bypass_guards:
            for guard_name, guard_fn in guard_list:
                ok = await guard_fn(entity, ctx)
                if not ok:
                    raise GuardFailedError(guard_name, f"Transition {current}->{target} blocked")
        self.set_status(entity, target)
        await self.log_transition(entity, current, target, user_id, ctx)
        return entity
