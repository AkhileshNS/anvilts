"""Minimal service code with a possible inventory/ledger lock inversion."""

from threading import Lock


class Warehouse:
    def __init__(self) -> None:
        self.inventory_lock = Lock()
        self.ledger_lock = Lock()

    def process_order(self) -> None:
        """Reserve stock, then record the charge."""
        with self.inventory_lock:
            self._reserve_inventory()
            with self.ledger_lock:
                self._record_charge()

    def issue_refund(self) -> None:
        """Record the credit, then return stock."""
        with self.ledger_lock:
            self._record_credit()
            with self.inventory_lock:
                self._restore_inventory()

    def _reserve_inventory(self) -> None:
        pass

    def _record_charge(self) -> None:
        pass

    def _record_credit(self) -> None:
        pass

    def _restore_inventory(self) -> None:
        pass
