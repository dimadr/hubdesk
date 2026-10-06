class InvalidTransitionError(Exception):
    def __init__(self, current: str, target: str, entity_id: int):
        self.current = current
        self.target = target
        self.entity_id = entity_id
        super().__init__(f"Invalid transition: {current} -> {target} for entity {entity_id}")


class GuardFailedError(Exception):
    def __init__(self, guard_name: str, reason: str):
        self.guard_name = guard_name
        self.reason = reason
        super().__init__(f"Guard '{guard_name}' failed: {reason}")
