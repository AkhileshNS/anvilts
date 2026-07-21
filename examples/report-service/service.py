from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from decimal import Decimal
from time import sleep
from typing import Protocol


@dataclass(frozen=True)
class AccountSnapshot:
    account_id: str
    balance: Decimal
    display_name: str


class SnapshotUnavailable(Exception):
    retryable = True


class SnapshotPending(SnapshotUnavailable):
    pass


class AccountArchived(SnapshotUnavailable):
    pass


class AccountRepository(Protocol):
    def load_snapshot(self, account_id: str) -> AccountSnapshot:
        ...


class RetryPolicy:
    def __init__(self, delay_seconds: float = 0.05) -> None:
        self._delay_seconds = delay_seconds

    def should_retry(self, error: SnapshotUnavailable) -> bool:
        return error.retryable

    def wait(self) -> None:
        sleep(self._delay_seconds)


class ReportService:
    def __init__(
        self,
        repository: AccountRepository,
        retry_policy: RetryPolicy | None = None,
        workers: int = 4,
    ) -> None:
        self._repository = repository
        self._retry_policy = retry_policy or RetryPolicy()
        self._executor = ThreadPoolExecutor(
            max_workers=workers,
            thread_name_prefix="reports",
        )

    def build_month_end_batch(self, account_ids: list[str]) -> list[str]:
        reports: list[Future[str]] = [
            self._executor.submit(self._build_report, account_id)
            for account_id in account_ids
        ]
        return [report.result() for report in reports]

    def _build_report(self, account_id: str) -> str:
        while True:
            try:
                snapshot = self._repository.load_snapshot(account_id)
            except SnapshotUnavailable as error:
                if not self._retry_policy.should_retry(error):
                    raise
                self._retry_policy.wait()
                continue

            return (
                f"{snapshot.display_name}: "
                f"closing balance {snapshot.balance:.2f}"
            )

    def close(self) -> None:
        self._executor.shutdown(wait=True)
