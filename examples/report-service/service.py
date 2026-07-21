from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class AccountSnapshot:
    account_id: str
    balance: Decimal
    display_name: str


class AccountRepository:
    def load_snapshot(self, account_id: str) -> AccountSnapshot:
        return AccountSnapshot(
            account_id=account_id,
            balance=Decimal("1250.00"),
            display_name=f"Account {account_id}",
        )


class ReportService:
    def __init__(self, repository: AccountRepository, workers: int = 4) -> None:
        self._repository = repository
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
        snapshot = self._executor.submit(
            self._repository.load_snapshot,
            account_id,
        ).result()
        return (
            f"{snapshot.display_name}: "
            f"closing balance {snapshot.balance:.2f}"
        )

    def close(self) -> None:
        self._executor.shutdown(wait=True)

