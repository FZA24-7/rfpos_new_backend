import type { Request, Response } from 'express';
import type {
  CreateAdminUserInput,
  GenerateOverheadInput,
  LogQuery,
  UpdateAdminUserInput,
  UserCategoryInput,
} from '@mafk/validation';
import {
  ADMIN_REGISTRY,
  BASELINE_PERMISSIONS,
  LOCKABLE_ATTRIBUTES,
  RIGHTS,
  supportedRights,
} from '@mafk/shared';
import { DomainError } from '../../domain/types.js';
import type { AdminOperationsService } from '../../services/admin-operations.service.js';
import type { AdminSecurityService } from '../../services/admin-security.service.js';

const actorFrom = (req: Request) => {
  if (!req.auth?.tenantId)
    throw new DomainError('TENANT_REQUIRED', 'This action requires a tenant context.', 403);
  return { id: req.auth.userId, tenantId: req.auth.tenantId, permissions: req.auth.permissions };
};
const idOf = (req: Request): string => (req.params as { id: string }).id;

export const createAdminController = (
  security: AdminSecurityService,
  ops: AdminOperationsService,
) => ({
  /** The module / form / report structure the Security File screen renders (from the registry, never a fixed list). */
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

  /** Active branches and user types for the Security File drop-downs (needs only security_file.view). */
  async lookups(req: Request, res: Response): Promise<void> {
    const tenantId = actorFrom(req).tenantId;
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
    const q = req.query as unknown as { q?: string; includeDisabled: boolean };
    res.status(200).json(await security.listUsers(actorFrom(req).tenantId, q));
  },
  async getUser(req: Request, res: Response): Promise<void> {
    res.status(200).json(await security.getUser(actorFrom(req), idOf(req)));
  },
  async createUser(req: Request, res: Response): Promise<void> {
    res
      .status(201)
      .json(await security.createUser(actorFrom(req), req.body as CreateAdminUserInput));
  },
  async updateUser(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(await security.updateUser(actorFrom(req), idOf(req), req.body as UpdateAdminUserInput));
  },
  async deleteUser(req: Request, res: Response): Promise<void> {
    await security.deleteUser(actorFrom(req), idOf(req));
    res.status(204).send();
  },

  async listCategories(req: Request, res: Response): Promise<void> {
    res.status(200).json(await ops.listCategories(actorFrom(req).tenantId));
  },
  async createCategory(req: Request, res: Response): Promise<void> {
    res.status(201).json(await ops.createCategory(actorFrom(req), req.body as UserCategoryInput));
  },
  async updateCategory(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(
        await ops.updateCategory(actorFrom(req), idOf(req), req.body as Partial<UserCategoryInput>),
      );
  },
  async deleteCategory(req: Request, res: Response): Promise<void> {
    await ops.deleteCategory(actorFrom(req), idOf(req));
    res.status(204).send();
  },

  async updateUserLocation(req: Request, res: Response): Promise<void> {
    await ops.updateUserLocation(
      actorFrom(req),
      idOf(req),
      (req.body as { storeId: string }).storeId,
    );
    res.status(204).send();
  },

  async getLocks(req: Request, res: Response): Promise<void> {
    res.status(200).json(await ops.getLocks(actorFrom(req).tenantId));
  },
  async setLocks(req: Request, res: Response): Promise<void> {
    const locked = await ops.setLocks(actorFrom(req), (req.body as { locks: string[] }).locks);
    res.status(200).json({ attributes: LOCKABLE_ATTRIBUTES, locked });
  },

  async getPeriod(req: Request, res: Response): Promise<void> {
    res.status(200).json(await ops.getPeriod(actorFrom(req).tenantId));
  },
  async closePeriod(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(
        await ops.closePeriod(
          actorFrom(req),
          (req.body as { closedThrough: string }).closedThrough,
        ),
      );
  },
  async reopenPeriod(req: Request, res: Response): Promise<void> {
    await ops.reopenPeriod(actorFrom(req));
    res.status(204).send();
  },

  async auditLog(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(await ops.auditLog(actorFrom(req).tenantId, req.query as unknown as LogQuery));
  },
  async smsLog(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(await ops.smsLog(actorFrom(req).tenantId, req.query as unknown as LogQuery));
  },
  async bankLog(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(await ops.bankLog(actorFrom(req).tenantId, req.query as unknown as LogQuery));
  },

  async listOverhead(req: Request, res: Response): Promise<void> {
    res.status(200).json(await ops.listOverheadRuns(actorFrom(req).tenantId));
  },
  async generateOverhead(req: Request, res: Response): Promise<void> {
    res
      .status(201)
      .json(await ops.generateOverhead(actorFrom(req), req.body as GenerateOverheadInput));
  },
  async deleteOverhead(req: Request, res: Response): Promise<void> {
    await ops.deleteOverheadRun(actorFrom(req), idOf(req));
    res.status(204).send();
  },

  async listLocations(req: Request, res: Response): Promise<void> {
    res.status(200).json(await ops.listLocations(actorFrom(req).tenantId));
  },
  async setLocationActive(req: Request, res: Response): Promise<void> {
    await ops.setLocationActive(
      actorFrom(req),
      idOf(req),
      (req.body as { isActive: boolean }).isActive,
    );
    res.status(204).send();
  },
});
