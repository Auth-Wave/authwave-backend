import { Response } from "express";
import { IRequest } from "../types/api.types";
import { asyncHandler } from "../utils/async-handler";
import { validateLogInput } from "../schema/validation";
import { securityLog } from "../features/security-log";
import mongoose from "mongoose";
import { responseType } from "../constants";
import { ApiResponse } from "../utils/custom-api-response";
import { ApiError } from "../utils/custom-api-error";
import { EventCode } from "../types/types";

// COMMON FOR ADMIN & USER:: GET ALL LOGS OF A PARTICULAR USER (USING ITS USER-ID)
export const getLogsByUserId = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Auth-middleware: Authenticate the user (or admin)
    const adminId = req.admin?.id;

    // Project-Validation-middleware: Validate the project
    const projectId = req.project?.id as string | mongoose.Types.ObjectId;

    // User-auth-middleware: Authenticate the user
    /*
      NOTE: 
      Since this middleware will be used by the admin as well as the users, the `userId` will either be fetched from the request-body (Request from the Admin) or attached by the user-auth middleware (Request from the User).
    */
    let userId = req.user?.id;
    if (!userId) {
      userId = req.body.userId;
    }

    // Get the details from the request-body
    const { page, itemLimit, startDate, endDate } = req.body;

    // Validate the format of the request-body details
    const validationResponse = validateLogInput({
      page,
      itemLimit,
      startDate,
      endDate,
      userId,
    });
    if (!validationResponse.success) {
      throw new ApiError(
        responseType.VALIDATION_ERROR.code,
        responseType.VALIDATION_ERROR.type,
        "Invalid data is passed in the Request-body.",
        validationResponse.errors
      );
    }

    // Get the documents from the database
    const logsFromDB = await securityLog.getLogsByUserID({
      userId,
      page,
      projectId,
      queryItemCount: itemLimit,
      startDate,
      endDate,
    });

    // Send response with data
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "Logs between the given dates fetched successfully",
          logsFromDB
        )
      );
  }
);

// ADMIN-SPECIFIC:: GET ALL SPECIFIC EVENT-LOGS OF A PROJECT (USING EVENT-CODE)
export const getLogsByEventCode = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Auth-middleware: Authenticate the user (or admin)
    const adminId = req.admin?.id;

    // Project-Validation-middleware: Validate the project
    const projectId = req.project?.id;

    // Get the details from the request-body
    const { page, itemLimit, startDate, endDate } = req.body;
    const eventCode = req.query.eventCode as string;
    if (!eventCode) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "Mandatory field Event-Code not provided."
      );
    }

    // Validate the format of the request-body details
    const validationResponse = validateLogInput({
      eventCode,
      page,
      itemLimit,
      startDate,
      endDate,
      projectId,
    });
    if (!validationResponse.success) {
      throw new ApiError(
        responseType.VALIDATION_ERROR.code,
        responseType.VALIDATION_ERROR.type,
        "Invalid data is passed in the Request-body.",
        validationResponse.errors
      );
    }

    // Get the documents from the database
    const logsFromDB = await securityLog.getAllLogsByEvent({
      projectId: projectId!,
      page,
      queryItemCount: itemLimit,
      eventCode,
      startDate,
      endDate,
    });

    // Send response with data
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          `${eventCode} Event Logs between the given dates fetched successfully`,
          logsFromDB
        )
      );
  }
);

// USER-SPECIFIC:: GET ALL SPECIFIC EVENT-LOGS OF THE USER (USING EVENT-CODE & PROJECT-ID)
export const getUserLogsByEventCode = asyncHandler(
  async (req: IRequest, res: Response) => {
    // User-Auth-middleware: Authenticate the user
    const userId = req.user?.id;

    // Project-Validation-middleware: Validate the project
    const projectId = req.project?.id;

    // Get the event-code from the request-query
    const eventCode = req.query.eventCode as string;
    if (!eventCode) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "Mandatory field Event-Code not provided."
      );
    }

    // Get the query details from request-body
    const { page, itemLimit, startDate, endDate } = req.body;

    // Validate the query details
    const validationResponse = validateLogInput({
      eventCode,
      page,
      itemLimit,
      startDate,
      endDate,
      projectId,
      userId,
    });
    if (!validationResponse.success) {
      throw new ApiError(
        responseType.VALIDATION_ERROR.code,
        responseType.VALIDATION_ERROR.type,
        "Invalid data is passed in the Request-body.",
        validationResponse.errors
      );
    }

    // Get the documents from the database
    const logsFromDB = await securityLog.getUserLogsByEvent({
      projectId: projectId!,
      userId,
      startDate,
      endDate,
      page,
      eventCode,
      queryItemCount: itemLimit,
    });

    // Send response with data
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          `${eventCode} Event Logs between the given dates fetched successfully`,
          logsFromDB
        )
      );
  }
);