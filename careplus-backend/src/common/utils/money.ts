import { PaymentType, Prisma } from "@prisma/client";

export function roundMoney(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export interface PaymentAggregationItem {
  type: PaymentType | string;
  amount: Prisma.Decimal | number | string;
}

export function aggregatePaymentTotals<T extends PaymentAggregationItem>(payments: T[]) {
  let gross = new Prisma.Decimal(0);
  let refunds = new Prisma.Decimal(0);

  for (const payment of payments) {
    const amt = new Prisma.Decimal(payment.amount ?? 0);
    if (payment.type === "REFUND") {
      refunds = refunds.plus(amt);
    } else {
      gross = gross.plus(amt);
    }
  }

  const roundedGross = roundMoney(gross);
  const roundedRefunds = roundMoney(refunds);
  const net = roundMoney(gross.minus(refunds));

  return {
    gross: roundedGross,
    refunds: roundedRefunds,
    net,
    grossNumber: Number(roundedGross),
    refundsNumber: Number(roundedRefunds),
    netNumber: Number(net),
  };
}
