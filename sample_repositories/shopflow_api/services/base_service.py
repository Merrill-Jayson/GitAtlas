"""Shared service layer base class and order domain business logic."""

from gateways.payment_gateway import PaymentGateway
from repositories.base_repo import OrderRepository


class BaseService:
    """Base application service with audit logging."""

    def __init__(self, service_name: str):
        self.service_name = service_name

    def emit_audit(self, event: str) -> str:
        """Record an internal service lifecycle event."""
        return f"[{self.service_name}] {event}"


def process_refund(
    gateway: PaymentGateway,
    order_repo: OrderRepository,
    order_id: str,
    transaction_id: str,
    amount_cents: int,
) -> str:
    """Reverse a captured payment and mark the order refunded."""
    refund_ref = gateway.refund_transaction(transaction_id, amount_cents)
    return order_repo.mark_refunded(order_id, refund_ref)


class OrderService(BaseService):
    """Coordinates checkout payment capture and order cancellation."""

    def __init__(self, order_repo: OrderRepository, payment_gateway: PaymentGateway):
        super().__init__("order-service")
        self.order_repo = order_repo
        self.payment_gateway = payment_gateway

    def place_order(self, user_id: str, items: list[dict], total_cents: int) -> dict:
        """Charge the customer payment gateway and persist the order."""
        if not items:
            raise ValueError("Cannot checkout with an empty cart")
        txn_id = self.payment_gateway.charge(total_cents, "USD", user_id)
        receipt = self.order_repo.save_order(
            {"user_id": user_id, "items": items, "transaction_id": txn_id}
        )
        self.emit_audit(f"order_placed:{txn_id}")
        return {"transaction_id": txn_id, "receipt": receipt}

    def cancel_and_refund(
        self, order_id: str, transaction_id: str, amount_cents: int
    ) -> str:
        """Cancel an existing order and trigger payment refund."""
        self.emit_audit(f"order_cancelled:{order_id}")
        return process_refund(
            self.payment_gateway,
            self.order_repo,
            order_id,
            transaction_id,
            amount_cents,
        )
