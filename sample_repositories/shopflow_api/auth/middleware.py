"""Authentication middleware and user session verification."""

from repositories.base_repo import UserRepository
from services.base_service import BaseService


class UserService(BaseService):
    """Validates bearer tokens and loads authenticated user context."""

    def __init__(self, user_repo: UserRepository):
        super().__init__("user-service")
        self.user_repo = user_repo

    def verify_session(self, raw_token: str) -> dict:
        """Validate token format and query the user repository."""
        if not raw_token or not raw_token.startswith("Bearer "):
            raise PermissionError("Missing Bearer token")
        token_hash = raw_token.replace("Bearer ", "").strip()
        user = self.user_repo.find_by_token(token_hash)
        if not user:
            raise PermissionError("Invalid or expired session token")
        return user


class AuthMiddleware:
    """HTTP request authentication filter executed before controllers."""

    def __init__(self, user_service: UserService):
        self.user_service = user_service

    def authenticate_request(self, headers: dict) -> dict:
        """Extract Authorization header and authenticate the caller."""
        auth_header = headers.get("Authorization", "")
        return self.user_service.verify_session(auth_header)
