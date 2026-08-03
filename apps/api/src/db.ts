import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient();

export const scopedPrisma = (orgId: string) => {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tenantModels = ['User', 'Product', 'Order', 'AuditLog'];
          const a = args as any;
          
          if (tenantModels.includes(model)) {
            if (
              ['findUnique', 'findFirst', 'findMany', 'update', 'updateMany', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy'].includes(
                operation
              )
            ) {
              a.where = { ...(a.where || {}), org_id: orgId };
            }
            if (['create', 'createMany'].includes(operation)) {
              if (Array.isArray(a.data)) {
                // Overwrite any forged org_id
                a.data = a.data.map((d: any) => ({ ...d, org_id: orgId }));
              } else if (a.data) {
                a.data = { ...a.data, org_id: orgId };
              }
            }
          }

          if (model === 'OrderItem') {
            if (['findMany', 'findFirst', 'count', 'aggregate'].includes(operation)) {
              a.where = { ...(a.where || {}), order: { org_id: orgId } };
            } else if (['findUnique', 'update', 'delete'].includes(operation)) {
              // Prisma requires unique where for these; we must pre-check ownership
              const id = a.where?.id;
              if (id) {
                // Use unscoped prisma to check ownership before allowing operation
                const item = await prisma.orderItem.findUnique({
                  where: { id },
                  select: { order: { select: { org_id: true } } },
                });
                if (item && item.order.org_id !== orgId) {
                  throw new Error('Unauthorized cross-tenant access to OrderItem');
                }
              }
            } else if (['create', 'createMany'].includes(operation)) {
              // Pre-check that the target Order belongs to the org
              const orderIds: string[] = Array.isArray(a.data)
                ? Array.from(new Set(a.data.map((d: any) => d.order_id).filter(Boolean)))
                : (a.data?.order_id ? [a.data.order_id] : []);

              for (const orderId of orderIds) {
                const order = await prisma.order.findUnique({ where: { id: orderId }, select: { org_id: true } });
                if (!order || order.org_id !== orgId) {
                  throw new Error('Unauthorized cross-tenant access to Order');
                }
              }
            }
          }

          return query(a);
        },
      },
    },
  });
};
