"""External payment processor gateway integration."""


class PaymentGateway:
    """Handles card authorizations, captures, and transaction refunds."""

    def __init__(self, merchant_id: str):
        self.merchant_id = merchant_id

    def charge(self, amount_cents: int, currency: str, customer_id: str) -> str:
        """Authorize and capture a payment charge."""
        if amount_cents <= 0:
            raise ValueError("Charge amount must be positive")
        return f"txn_charge_{customer_id}_{amount_cents}_{currency}"

    def refund_transaction(self, transaction_id: str, amount_cents: int) -> str:
        """Issue a refund to the original payment method."""
        return f"refund_{transaction_id}_{amount_cents}"
