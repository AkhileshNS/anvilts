from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from typing import Callable


@dataclass(frozen=True)
class Document:
    document_id: str
    owner_id: str
    title: str


@dataclass(frozen=True)
class AuditEvent:
    document_id: str
    action: str


class AuditBuffer:
    def __init__(self, sink: Callable[[list[dict[str, str]]], None]) -> None:
        self._sink = sink
        self._pending: list[AuditEvent] = []
        self._pending_lock = Lock()
        self._store: DocumentStore | None = None

    def attach_store(self, store: DocumentStore) -> None:
        self._store = store

    def record(self, event: AuditEvent) -> None:
        with self._pending_lock:
            self._pending.append(event)

    def flush(self) -> None:
        with self._pending_lock:
            if not self._pending:
                return

            store = self._store
            if store is None:
                raise RuntimeError("Document store has not been attached")

            document_ids = {event.document_id for event in self._pending}
            metadata = store.snapshot_metadata(document_ids)
            payload = [
                {
                    "document_id": event.document_id,
                    "action": event.action,
                    "owner_id": metadata.get(event.document_id, "deleted"),
                }
                for event in self._pending
            ]
            self._sink(payload)
            self._pending.clear()


class DocumentStore:
    def __init__(self, audit: AuditBuffer) -> None:
        self._audit = audit
        self._documents: dict[str, Document] = {}
        self._documents_lock = Lock()

    def put(self, document: Document) -> None:
        with self._documents_lock:
            self._documents[document.document_id] = document

    def delete(self, document_id: str) -> bool:
        with self._documents_lock:
            document = self._documents.pop(document_id, None)
            if document is None:
                return False

            self._audit.record(AuditEvent(document_id, "document.deleted"))
            return True

    def snapshot_metadata(self, document_ids: set[str]) -> dict[str, str]:
        with self._documents_lock:
            return {
                document_id: document.owner_id
                for document_id, document in self._documents.items()
                if document_id in document_ids
            }


class DocumentService:
    def __init__(self, audit_sink: Callable[[list[dict[str, str]]], None]) -> None:
        self.audit = AuditBuffer(audit_sink)
        self.documents = DocumentStore(self.audit)
        self.audit.attach_store(self.documents)

