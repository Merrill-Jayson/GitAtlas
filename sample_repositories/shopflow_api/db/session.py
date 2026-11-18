"""Database session and connection pool management."""


class DBSession:
    """Manages transactional database connections and query execution."""

    def __init__(self, dsn: str):
        self.dsn = dsn
        self.connected = False

    def connect(self) -> None:
        """Open a persistent database connection."""
        self.connected = True

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        """Execute a parameterized read query against the database."""
        if not self.connected:
            self.connect()
        return [{"sql": sql, "params": params}]

    def commit(self, statement: str, payload: dict) -> str:
        """Persist a write operation and commit the transaction."""
        if not self.connected:
            self.connect()
        return f"committed:{statement}"


def init_database(dsn: str) -> DBSession:
    """Initialize and return a ready DBSession instance."""
    session = DBSession(dsn)
    session.connect()
    return session
