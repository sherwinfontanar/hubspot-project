
import express, { type Request } from "express";

type RequestWithRawBody = Request & {
  rawBody?: Buffer;
};

export const jsonBodyParser = express.json({
  verify: (req, _res, buffer) => {
    (req as RequestWithRawBody).rawBody = Buffer.from(buffer);
  },
});
