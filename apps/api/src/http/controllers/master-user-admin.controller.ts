import type { Request, Response } from 'express';
import type { CreateAdminUserInput, UpdateAdminUserInput } from '@mafk/validation';
import {
  ADMIN_REGISTRY,
  BASELINE_PERMISSIONS,
  isGrantableToTenantRole,
  PERMISSION_CATALOG,
  RIGHTS,
  supportedRights,
} from '@mafk/shared';
import { DomainError } from '../../domain/types.js';
import type { AdminOperationsService } from '../../services/admin-operations.service.js';
import type { AdminActor, AdminSecurityService } from '../../services/admin-security.service.js';

/** The platform Master Admin may hand out any right a business could hold. */
const ALL_TENANT_GRANTS: ReadonlySet<string> = new Set(
  PERMISSION_CATALOG.filter((k) => isGrantableToTenantRole(k)),
);

const params = (req: Request) => req.params as { id: string; userId?: string };

/**
 * The Master Admin's own view of the Security File: the same user/rights service the businesses use, but aimed at ANY
 * business by id. Every call names the business explicitly, and the business must exist.
 */
export const createMasterUserAdminController = (
  security: AdminSecurityService,
  ops: AdminOperationsService,
) => {
  const actorFor = async (req: Request): Promise<AdminActor> => {
    if (!req.auth) throw new DomainError('UNAUTHENTICATED', 'Authentication required.', 401);
    const tenantId = params(req).id;
    await security.assertTenantExists(tenantId);
    return { id: req.auth.userId, tenantId, permissions: ALL_TENANT_GRANTS };
  };

  return {
    registry(_req: Request, res: Response): void {
      res.status(200).json({
        rights: RIGHTS,
        baseline: BASELINE_PERMISSIONS,
        modules: ADMIN_REGISTRY.map((m) => ({
          key: m.key,
          prefix: m.prefix,
          name: m.name,
          items: m.items.map((i) => ({
            key: i.key,
            name: i.name,
            kind: i.kind,
            rights: supportedRights(i),
            uses: i.uses ?? [],
          })),
        })),
      });
    },
    async lookups(req: Request, res: Response): Promise<void> {
      const { tenantId } = await actorFor(req);
      const [categories, locations] = await Promise.all([
        ops.listCategories(tenantId),
        ops.listLocations(tenantId),
      ]);
      res.status(200).json({
        categories: categories
          .filter((c) => c.isActive)
          .map((c) => ({ id: c.id, code: c.code, name: c.name })),
        locations: locations
          .filter((l) => l.isActive)
          .map((l) => ({ id: l.id, code: l.code, name: l.name })),
      });
    },
    async listUsers(req: Request, res: Response): Promise<void> {
      const { tenantId } = await actorFor(req);
      const q = req.query as unknown as { q?: string; includeDisabled: boolean };
      res.status(200).json(await security.listUsers(tenantId, q));
    },
    async getUser(req: Request, res: Response): Promise<void> {
      res.status(200).json(await security.getUser(await actorFor(req), params(req).userId ?? ''));
    },
    async createUser(req: Request, res: Response): Promise<void> {
      res
        .status(201)
        .json(await security.createUser(await actorFor(req), req.body as CreateAdminUserInput));
    },
    async updateUser(req: Request, res: Response): Promise<void> {
      res
        .status(200)
        .json(
          await security.updateUser(
            await actorFor(req),
            params(req).userId ?? '',
            req.body as UpdateAdminUserInput,
          ),
        );
    },
    async deleteUser(req: Request, res: Response): Promise<void> {
      await security.deleteUser(await actorFor(req), params(req).userId ?? '');
      res.status(204).send();
    },
  };
};
