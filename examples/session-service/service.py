from __future__ import annotations

import asyncio
from dataclasses import dataclass


@dataclass
class Session:
    token: str
    user_id: str
    key_epoch: int


class KeyRing:
    def __init__(self) -> None:
        self._epoch = 1
        self._lock = asyncio.Lock()
        self._sessions: SessionRegistry | None = None

    def attach_sessions(self, sessions: SessionRegistry) -> None:
        self._sessions = sessions

    async def current_epoch(self) -> int:
        async with self._lock:
            return self._epoch

    async def rotate(self) -> int:
        async with self._lock:
            self._epoch += 1
            sessions = self._sessions
            if sessions is None:
                raise RuntimeError("Session registry has not been attached")

            await sessions.expire_before(self._epoch)
            return self._epoch


class SessionRegistry:
    def __init__(self, keys: KeyRing) -> None:
        self._keys = keys
        self._sessions: dict[str, Session] = {}
        self._lock = asyncio.Lock()

    async def create(self, token: str, user_id: str) -> Session:
        key_epoch = await self._keys.current_epoch()
        async with self._lock:
            session = Session(token, user_id, key_epoch)
            self._sessions[token] = session
            return session

    async def refresh(self, token: str) -> Session | None:
        async with self._lock:
            session = self._sessions.get(token)
            if session is None:
                return None

            session.key_epoch = await self._keys.current_epoch()
            return session

    async def expire_before(self, epoch: int) -> int:
        async with self._lock:
            stale_tokens = [
                token
                for token, session in self._sessions.items()
                if session.key_epoch < epoch
            ]
            for token in stale_tokens:
                del self._sessions[token]
            return len(stale_tokens)


class SessionService:
    def __init__(self) -> None:
        self.keys = KeyRing()
        self.sessions = SessionRegistry(self.keys)
        self.keys.attach_sessions(self.sessions)

    async def open_session(self, token: str, user_id: str) -> Session:
        return await self.sessions.create(token, user_id)
