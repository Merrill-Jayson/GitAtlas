"""HTTP controller endpoints for checkout and order lifecycle."""

from auth.middleware import AuthMiddleware
from gateways.payment_gateway import PaymentGateway
from services.base_service import OrderService, process_refund


class OrderController:
    """Handles incoming HTTP API requests for orders."""

    def __init__(self, auth: AuthMiddleware, order_service: OrderService):
        self.auth = auth
        self.order_service = order_service

    def create_order(self, headers: dict, body: dict) -> dict:
        """Authenticate caller and execute order checkout."""
        user = self.auth.authenticate_request(headers)
        return self.order_service.place_order(
            user_id=user.get("id", "anon"),
            items=body.get("items", []),
            total_cents=body.get("total_cents", 0),
        )

    def cancel_order(self, headers: dict, body: dict) -> dict:
        """Authenticate caller and cancel an order with refund."""
        self.auth.authenticate_request(headers)
        status = self.order_service.cancel_and_refund(
            order_id=body["order_id"],
            transaction_id=body["transaction_id"],
            amount_cents=body["amount_cents"],
        )
        return {"status": status}


def run_batch_refund(
    gateway: PaymentGateway,
    order_repo,
    items: list[dict],
    plugin_hook=None,
) -> list[str]:
    """Batch worker calling process_refund and optional dynamic hook."""
    results = []
    for item in items:
        results.append(
            process_refund(
                gateway,
                order_repo,
                item["order_id"],
                item["transaction_id"],
                item["amount_cents"],
            )
        )
    if plugin_hook is not None:
        handler = getattr(plugin_hook, "on_complete", None)
        if handler:
            handler(results)
    return results
