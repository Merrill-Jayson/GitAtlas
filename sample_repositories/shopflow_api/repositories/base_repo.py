"""Repository persistence layer with base abstraction."""

from db.session import DBSession


class BaseRepository:
    """Base repository providing shared database query execution."""

    def __init__(self, session: DBSession):
        self.session = session

    def execute_query(self, sql: str, params: tuple = ()) -> list[dict]:
        """Delegate SQL execution to the active DBSession."""
        return self.session.query(sql, params)

    def execute_write(self, statement: str, payload: dict) -> str:
        """Persist mutations via DBSession.commit."""
        return self.session.commit(statement, payload)


class UserRepository(BaseRepository):
    """Data access methods for user accounts and auth tokens."""

    def find_by_token(self, token_hash: str) -> dict | None:
        """Fetch an active user record matching a bearer token hash."""
        rows = self.execute_query(
            "SELECT id, email, role FROM users WHERE token_hash = %s",
            (token_hash,),
        )
        return rows[0] if rows else None


class OrderRepository(BaseRepository):
    """Data access methods for customer orders and refunds."""

    def save_order(self, order_data: dict) -> str:
        """Insert a new order record into the orders table."""
        return self.execute_write("INSERT INTO orders", order_data)

    def mark_refunded(self, order_id: str, refund_ref: str) -> str:
        """Update order status to refunded after payment reversal."""
        return self.execute_write(
            "UPDATE orders SET status='refunded'",
            {"order_id": order_id, "refund_ref": refund_ref},
        )
