export type AuditAction = 
  | 'USER_INVITED' 
  | 'USER_REMOVED' 
  | 'ORDER_CANCELLED' 
  | 'STOCK_UPDATED' 
  | 'ORDER_DELETED'
  | 'BULK_PRODUCTS_IMPORTED';

interface AuditParams {
  orgId: string;
  actorId: string;
  action: AuditAction;
  targetId?: string;
  details?: Record<string, any>;
}

export async function createAuditEntry(tx: any, params: AuditParams) {
  return tx.auditLog.create({
    data: {
      org_id: params.orgId,
      actor_id: params.actorId,
      action: params.action,
      target_id: params.targetId || null,
      details: params.details ? JSON.stringify(params.details) : null,
    },
  });
}
