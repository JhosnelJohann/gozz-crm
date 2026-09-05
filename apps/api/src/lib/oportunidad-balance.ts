import { query } from "../shared/db.js";

/**
 * Fuente ÚNICA de verdad del balance de una oportunidad. El descuento aprobado es una REBAJA del
 * valor a cobrar, NO un pago. Por eso:
 *
 *   total_a_cobrar = max(0, valor_total - descuentos_aprobados)
 *   balance        = max(0, total_a_cobrar - pagos_reales)      // lo que aún debe el cliente
 *   a_reintegrar   = max(0, pagos_reales - total_a_cobrar)      // saldo a favor del cliente
 *
 * `total_descuentos` suma `monto_efectivo` (el snapshot que se fija al aprobar) de los descuentos
 * en estado 'aprobado'. `pagos_reales` excluye anulados. Todos los endpoints que mueven pagos,
 * descuentos o el valor_total deben pasar por aquí para no volver a divergir.
 */
export interface BalanceBreakdown {
  valorTotal: number;
  totalDescuentos: number;
  totalACobrar: number;
  totalPagado: number;
  balance: number;
  aReintegrar: number;
}

export async function getBalanceBreakdown(oportunidadId: string): Promise<BalanceBreakdown> {
  const op = (await query<any>("SELECT valor_total FROM gozz.oportunidades WHERE id = $1", [oportunidadId]))[0];
  const valorTotal = Number(op?.valor_total || 0);

  const pag = (await query<any>(
    "SELECT COALESCE(SUM(monto),0)::numeric(12,2) AS t FROM gozz.oportunidades_pagos WHERE oportunidad_id = $1 AND anulado = false",
    [oportunidadId]
  ))[0];
  const totalPagado = Number(pag?.t || 0);

  const desc = (await query<any>(
    // 'aprobada' en femenino desde la 0065: la tabla de descuentos ya no tiene vocabulario propio.
    "SELECT COALESCE(SUM(monto_efectivo),0)::numeric(12,2) AS t FROM gozz.oportunidad_descuento_solicitudes WHERE oportunidad_id = $1 AND estado = 'aprobada'",
    [oportunidadId]
  ))[0];
  const totalDescuentos = Number(desc?.t || 0);

  const totalACobrar = Math.max(0, valorTotal - totalDescuentos);
  const balance = Math.max(0, totalACobrar - totalPagado);
  const aReintegrar = Math.max(0, totalPagado - totalACobrar);

  return { valorTotal, totalDescuentos, totalACobrar, totalPagado, balance, aReintegrar };
}

/** Recalcula el breakdown y persiste balance_pendiente. Devuelve el breakdown completo. */
export async function recomputeBalance(oportunidadId: string): Promise<BalanceBreakdown> {
  const b = await getBalanceBreakdown(oportunidadId);
  await query("UPDATE gozz.oportunidades SET balance_pendiente = $1 WHERE id = $2", [b.balance, oportunidadId]);
  return b;
}
