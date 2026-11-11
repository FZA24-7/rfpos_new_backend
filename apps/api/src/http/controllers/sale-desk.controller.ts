import type { Request, Response } from 'express';
import { pcSerialOf } from '../pc-serial.js';
import type {
  CashActivityListQuery,
  CashActivityQuery,
  ClearClosingInput,
  DeskBillListQuery,
  DeskBillWiseQuery,
  DeskDailyClosingQuery,
  DeskSalesPersonQuery,
  FbrListQuery,
  FbrRepostInput,
  PcSerialInput,
  RepostCashInput,
  SaveCashActivityInput,
  UpdateTenderInput,
} from '@mafk/validation';
import type {
  DeskActor,
  DeskReportResult,
  SaleDeskService,
} from '../../services/sale-desk.service.js';
import { DomainError } from '../../domain/types.js';

const actorFrom = (req: Request): DeskActor => {
  if (!req.auth?.tenantId)
    throw new DomainError('TENANT_REQUIRED', 'This action requires a tenant context.', 403);
  return {
    id: req.auth.userId,
    tenantId: req.auth.tenantId,
    permissions: [...req.auth.permissions],
    pcSerial: pcSerialOf(req),
  };
};

const sendCsv = (res: Response, file: { filename: string; content: string }): void => {
  res
    .status(200)
    .setHeader('Content-Type', 'text/csv; charset=utf-8')
    .setHeader('Content-Disposition', `attachment; filename="${file.filename}"`)
    .send(file.content);
};

export const createSaleDeskController = (svc: SaleDeskService) => {
  const report =
    <Q extends { format: 'json' | 'csv' }>(
      run: (a: DeskActor, q: Q) => Promise<DeskReportResult>,
    ) =>
    async (req: Request, res: Response): Promise<void> => {
      const q = req.query as unknown as Q;
      const result = await run(actorFrom(req), q);
      if (q.format === 'csv') sendCsv(res, svc.reportCsv(result));
      else res.status(200).json(result);
    };
  return {
    async lookups(req: Request, res: Response): Promise<void> {
      res.status(200).json(await svc.lookups(actorFrom(req)));
    },
    async setShopRegion(req: Request, res: Response): Promise<void> {
      const { id } = req.params as { id: string };
      res
        .status(200)
        .json(await svc.setShopRegion(actorFrom(req), id, (req.body as { region: string }).region));
    },
    dailyClosing: report<DeskDailyClosingQuery>((a, q) => svc.dailyClosing(a, q)),
    billWise: report<DeskBillWiseQuery>((a, q) => svc.billWise(a, q)),
    salesPerson: report<DeskSalesPersonQuery>((a, q) => svc.salesPerson(a, q)),

    async cashActivity(req: Request, res: Response): Promise<void> {
      res
        .status(200)
        .json(await svc.cashActivity(actorFrom(req), req.query as unknown as CashActivityQuery));
    },
    async saveCashActivity(req: Request, res: Response): Promise<void> {
      res
        .status(200)
        .json(await svc.saveCashActivity(actorFrom(req), req.body as SaveCashActivityInput));
    },
    async clearClosing(req: Request, res: Response): Promise<void> {
      res.status(200).json(await svc.clearClosing(actorFrom(req), req.body as ClearClosingInput));
    },
    async listCashActivities(req: Request, res: Response): Promise<void> {
      res
        .status(200)
        .json(
          await svc.listCashActivities(
            actorFrom(req),
            req.query as unknown as CashActivityListQuery,
          ),
        );
    },
    async repostCash(req: Request, res: Response): Promise<void> {
      res
        .status(200)
        .json(await svc.repostCashActivities(actorFrom(req), req.body as RepostCashInput));
    },

    async listBills(req: Request, res: Response): Promise<void> {
      res
        .status(200)
        .json(await svc.listBills(actorFrom(req), req.query as unknown as DeskBillListQuery));
    },
    async getTender(req: Request, res: Response): Promise<void> {
      const { id } = req.params as { id: string };
      res.status(200).json(await svc.tenderOfBill(actorFrom(req), id));
    },
    async updateTender(req: Request, res: Response): Promise<void> {
      const { id } = req.params as { id: string };
      res
        .status(200)
        .json(await svc.updateTender(actorFrom(req), id, req.body as UpdateTenderInput));
    },

    async fbrList(req: Request, res: Response): Promise<void> {
      const q = req.query as unknown as FbrListQuery;
      const result = await svc.fbrList(actorFrom(req), q);
      if (q.format === 'csv') sendCsv(res, svc.fbrCsv(result.items, q));
      else res.status(200).json(result);
    },
    async fbrRepost(req: Request, res: Response): Promise<void> {
      res.status(200).json(await svc.fbrRepost(actorFrom(req), req.body as FbrRepostInput));
    },

    async listSerials(req: Request, res: Response): Promise<void> {
      res.status(200).json(await svc.listSerials(actorFrom(req)));
    },
    async setSerial(req: Request, res: Response): Promise<void> {
      const { userId } = req.params as { userId: string };
      res.status(200).json(await svc.setSerial(actorFrom(req), userId, req.body as PcSerialInput));
    },
  };
};
