import { NextFunction, query, Request, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
import { ApiError } from "../utils/custom-api-error";
import { cookieOptions, env, responseType } from "../constants";
import { validateLogInput, validateSignupInput } from "../schema/validation";
import { ApiResponse } from "../utils/custom-api-response";
import { filterObject } from "../utils/filter-object";
import { generateToken } from "../utils/token-generator";
import { IRequest } from "../types/types";
import { Admin } from "../models/admin.model";
import jwt from "jsonwebtoken";
import { User } from "../models/user.model";
import { Session } from "../models/session.model";
import mongoose, { Types } from "mongoose";
import { Project } from "../models/project.model";
import { Log } from "../models/security-log.model";

/* -------------------------- ADMIN AUTHENTICATION CONTROLLERS ----------------------------- */

// CREATE ADMIN ACCOUNT
export const createAccount = asyncHandler(
  async (req: Request, res: Response) => {
    // Get the user credentials
    const { name, email, password } = req.body;
    if (!(name && email && password)) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "One or more required field(s) are not provided."
      );
    }
    // Validate schema of input fields
    const validation = validateSignupInput({ username: name, password, email });
    if (!validation.success) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Please enter all the input field data in valid format",
        validation.errors
      );
    }
    // Verify if admin already exists
    const adminFromDB = await Admin.findOne({
      email,
    });
    if (adminFromDB) {
      throw new ApiError(
        responseType.ALREADY_EXISTS.code,
        responseType.ALREADY_EXISTS.type,
        "Admin already present in the database. Please Login."
      );
    }
    // Create a new account
    const createdAdmin = await Admin.create({
      name,
      email,
      password,
    });

    // Remove sensitive data from the user-data (newly created)
    /* Note: Another database call is not made to reduce the number of interactions with the Database */
    const adminData = filterObject(createdAdmin, [], ["password"]);

    // Send response
    res
      .status(200)
      .json(
        new ApiResponse(
          responseType.ACCOUNT_CREATED.code,
          responseType.ACCOUNT_CREATED.type,
          "Admin account created successfully.",
          adminData
        )
      );
  }
);

// SECURED ROUTE: DELETE ADMIN ACCOUNT
export const deleteAccount = asyncHandler(
  async (req: IRequest, res: Response, next: NextFunction) => {
    // Authenticate the admin
    const adminId = req.admin?.id;

    // Delete admin-document
    await Admin.findByIdAndDelete(adminId);

    // Get all the projects owned by the admin
    const projectsToBeDeleted = await Project.find({ owner: adminId });

    // Delete all projects whose owner is the current admin
    await Project.deleteMany({ owner: adminId });

    // Delete all users associated with the projects owned by the admin
    await User.deleteMany({
      projectId: { $in: projectsToBeDeleted.map((project) => project._id) },
    });

    // Delete all sessions associated with the projects owned by the admin
    await Session.deleteMany({
      projectId: { $in: projectsToBeDeleted.map((project) => project._id) },
    });

    // Delete all the logs associated with the projects owned by the admin
    await Log.deleteMany({
      projectId: { $in: projectsToBeDeleted.map((project) => project._id) },
    });

    // Clear all browser cookies and send response
    res
      .status(responseType.ACCOUNT_DELETED.code)
      .clearCookie("admin-access-token")
      .clearCookie("admin-refresh-token")
      .json(
        new ApiResponse(
          responseType.ACCOUNT_DELETED.code,
          responseType.ACCOUNT_DELETED.type,
          "Admin Account deleted successfully",
          {}
        )
      );
  }
);

// SECURED ROUTE: UPDATE ADMIN ACCOUNT DETAILS
export const updateAdminAccount = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-auth middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Get the data from the request-body
    const { name, email, password } = req.body;

    if (!name && !email && !password) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "No data provided in the Request body."
      );
    }

    // Find the admin from the database and update the details
    const adminFromDB = await Admin.findById(adminId).select(
      "-refreshToken -refreshTokenExpiry -accessToken -accessTokenExpiry -__v"
    );
    if (name) {
      adminFromDB!.name = name;
    }
    if (email) {
      adminFromDB!.email = email;
    }
    if (password) {
      adminFromDB!.password = password;
    }

    await adminFromDB!.save();

    // Send response
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "Admin data updated successfully",
          adminFromDB
        )
      );
  }
);

// CREATE ADMIN LOGIN SESSION
export const createLoginSession = asyncHandler(
  async (req: Request, res: Response) => {
    // Get the admin credentials
    const { email, password } = req.body;
    if (!(email && password)) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "One or more field(s) are not provided. Please enter all fields."
      );
    }
    // Validate schema of input fields
    const validation = validateSignupInput({ password, email });
    if (!validation.success) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Please enter all the input field data in valid format",
        validation.errors
      );
    }

    // Check if the admin exists in the database
    const adminFromDB = await Admin.findOne({ email });
    if (!adminFromDB) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "Admin not found in database. Enter the correct login credentials"
      );
    }

    // Validate the password
    const isPasswordCorrect = await adminFromDB.validatePassword(password);
    if (!isPasswordCorrect) {
      throw new ApiError(
        responseType.INCORRECT_PASSWORD.code,
        responseType.INCORRECT_PASSWORD.type,
        "Please provide valid credentials"
      );
    }

    // Generate access and refresh tokens
    const accessToken = generateToken(
      {
        adminId: adminFromDB._id,
        email: adminFromDB.email,
      },
      env.token.accessToken.secret,
      env.token.accessToken.expiry
    );
    const refreshToken = generateToken(
      {
        adminId: adminFromDB._id,
        email: adminFromDB.email,
      },
      env.token.refreshToken.secret,
      env.token.refreshToken.expiry
    );
    // Generate token expiries (in Date format)
    const accessTokenExpiry = new Date(
      new Date().getTime() + 24 * 60 * 60 * 1000
    );
    const refreshTokenExpiry = new Date(
      new Date().getTime() + 30 * 24 * 60 * 60 * 1000
    );

    // Update the tokens in the admin-document
    adminFromDB.refreshToken = refreshToken;
    adminFromDB.refreshTokenExpiry = refreshTokenExpiry;
    adminFromDB.accessToken = accessToken;
    adminFromDB.accessTokenExpiry = accessTokenExpiry;
    await adminFromDB.save();

    const adminData = filterObject(adminFromDB, [], ["password"]);

    // Set browser cookies and send response
    res
      .status(responseType.SESSION_CREATED.code)
      .cookie("admin-access-token", accessToken, {
        ...cookieOptions,
        maxAge: 1 * 24 * 60 * 60 * 1000,
      })
      .cookie("admin-refresh-token", refreshToken, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      })
      .json(
        new ApiResponse(
          responseType.SESSION_CREATED.code,
          responseType.SESSION_CREATED.type,
          "Login session created successfully",
          adminData
        )
      );
  }
);

// GET CURRENT LOGGED-IN ADMIN
export const getCurrentAdmin = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-auth-middleware
    const adminId = req.admin?.id;

    // Get the current admin from the database
    const adminFromDB = await Admin.findById(adminId).select(
      "-password -verificationToken -verificationTokenExpiry -resetPasswordToken -resetPasswordTokenExpiry"
    );
    if (!adminFromDB) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "Admin not found in the database"
      );
    }

    // Send response with admin data
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "Currently logged-in admin fetched successfully",
          adminFromDB
        )
      );
  }
);

// SECURED ROUTE: DELETE ADMIN LOGIN SESSION
export const deleteLoginSession = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-Auth-Middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Delete the token details from the admin-document in database
    await Admin.findByIdAndUpdate(adminId, {
      refreshToken: null,
      refreshTokenExpiry: null,
      accessToken: null,
      accessTokenExpiry: null,
    });

    // Clear the browser cookies and send response
    res
      .status(responseType.SESSION_DELETED.code)
      .clearCookie("admin-access-token")
      .clearCookie("admin-refresh-token")
      .json(
        new ApiResponse(
          responseType.SESSION_DELETED.code,
          responseType.SESSION_DELETED.type,
          "Admin login session deleted successfully",
          {}
        )
      );
  }
);

// REFRESH THE ACCESS TOKEN
export const refreshAccessToken = asyncHandler(
  async (req: Request, res: Response) => {
    // Get the refresh token from the browser cookies or request header
    const refreshToken =
      req.headers.authorization?.replace("Bearer ", "") ||
      req.cookies["admin-refresh-token"];
    if (!refreshToken) {
      throw new ApiError(
        responseType.REFRESH_TOKEN_INVALID.code,
        responseType.REFRESH_TOKEN_INVALID.type,
        "Refresh token not found in browser cookies or request headers"
      );
    }

    // Decode the refresh token to get adminId
    const decodedToken = jwt.decode(refreshToken) as {
      adminId: string;
    } | null;
    if (!decodedToken || !decodedToken.adminId) {
      throw new ApiError(
        responseType.REFRESH_TOKEN_INVALID.code,
        responseType.REFRESH_TOKEN_INVALID.type,
        "Admin-ID could not be fetched from the refresh token"
      );
    }
    const adminId = decodedToken.adminId;
    const adminFromDB = await Admin.findById(adminId).select("-password");
    if (!adminFromDB) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "Admin corresponding to the refresh token not found in the database"
      );
    }
    if (adminFromDB.refreshTokenExpiry < new Date()) {
      throw new ApiError(
        responseType.REFRESH_TOKEN_EXPIRED.code,
        responseType.REFRESH_TOKEN_EXPIRED.type,
        "Please log in again using credentials"
      );
    }

    // Generate a new access token
    const accessToken = generateToken(
      {
        adminId,
        email: adminFromDB.email,
      },
      env.token.accessToken.secret,
      env.token.accessToken.expiry
    );

    // Generate token expiries (in Date format)
    const accessTokenExpiry = new Date(
      new Date().getTime() + 24 * 60 * 60 * 1000
    );

    // Update the tokens in the admin-document
    adminFromDB.accessToken = accessToken;
    adminFromDB.accessTokenExpiry = accessTokenExpiry;
    await adminFromDB.save();

    const adminData = filterObject(adminFromDB, [], ["password"]);

    // Set browser cookies and send response
    res
      .status(responseType.SUCCESSFUL.code)
      .cookie("admin-access-token", accessToken, {
        ...cookieOptions,
        maxAge: 1 * 24 * 60 * 60 * 1000,
      })
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "Access token has been refreshed successfully",
          adminData
        )
      );
  }
);

/* ----------------------- ADMIN CONSOLE RELATED CONTROLLERS -------------------------- */

// GET DETAILS OF A USER IN A PROJECT
export const getUserFromConsole = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-Auth middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Project-Validation middleware: Validat the project
    const projectId = req.project?.id;

    // Get the userId from the request params
    const userId = req.params.userId as string;
    if (!userId) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "User-ID not provided in the Request-Parameters."
      );
    }

    // Find the user from the database
    const userFromDB = await User.findById(userId).select("-password");
    if (!userFromDB) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "User with the provided User-ID not found in the database."
      );
    }

    // Find all active sessions of the user
    const sessionsFromDB = await Session.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
        },
      },
      {
        $project: {
          projectId: 0,
          accessToken: 0,
          accessTokenExpiry: 0,
          refreshToken: 0,
          refreshTokenExpiry: 0,
          __v: 0,
          updatedAt: 0,
        },
      },
    ]);

    // Create response-data
    const responseData = {
      user: userFromDB,
      sessionCount: sessionsFromDB.length,
      sessions: sessionsFromDB,
    };

    res
      .status(200)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "User-details fetched successfully",
          responseData
        )
      );
  }
);

// SEARCH A USER IN A PROJECT
export const searchUsersFromConsole = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-Auth middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Project-Validation middleware: Validate the project
    const projectId = req.project?.id;

    // Get details from request-query parameters
    const page = req.query.page ? Number(req.query.page) : undefined;
    const itemLimit = req.query.itemLimit
      ? Number(req.query.itemLimit)
      : undefined;
    const startDate = req.query.startDate
      ? String(req.query.startDate)
      : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined;
    const searchQuery = req.query.searchQuery as string;

    // Validate the format of request-query parameters
    const validationResponse = validateLogInput({
      page: Number(page),
      itemLimit: Number(itemLimit),
      startDate,
      endDate,
      projectId,
    });
    if (!validationResponse.success) {
      throw new ApiError(
        responseType.VALIDATION_ERROR.code,
        responseType.VALIDATION_ERROR.type,
        "Invalid data is passed in the Request-query parameters.",
        validationResponse.errors
      );
    }

    // Search the users from the database
    const usersFromDB = await User.searchUsers({
      searchQuery,
      projectId: projectId!,
      page: Number(page),
      queryItemCount: Number(itemLimit),
      startDate,
      endDate,
    });

    // Send response
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "Users fetched successfully",
          usersFromDB
        )
      );
  }
);

// GET ALL USERS IN A PROJECT
export const getAllUsersFromConsole = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-Auth middleware
    const adminId = req.admin?.id;

    // Project-Validation middleware
    const projectId = req.project?.id;

    // Get details from request-query parameters
    const page = req.query.page ? Number(req.query.page) : undefined;
    const itemLimit = req.query.itemLimit
      ? Number(req.query.itemLimit)
      : undefined;
    const startDate = req.query.startDate
      ? String(req.query.startDate)
      : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined;

    // Validate the format of request-query parameters
    const validationResponse = validateLogInput({
      page: Number(page),
      itemLimit: Number(itemLimit),
      startDate,
      endDate,
      projectId,
    });
    if (!validationResponse.success) {
      throw new ApiError(
        responseType.VALIDATION_ERROR.code,
        responseType.VALIDATION_ERROR.type,
        "Invalid data is passed in the Request-query parameters.",
        validationResponse.errors
      );
    }

    // Get users from database
    const usersFromDB = await User.getUsersByProject({
      projectId: projectId!,
      page: Number(page),
      queryItemCount: Number(itemLimit),
      startDate,
      endDate,
    });

    // Send response
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "Users fetched successfully",
          usersFromDB
        )
      );
  }
);

// VERIFY A USER MANUALLY
export const verifyUserFromConsole = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-auth middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Project-Validation middleware: Validate the project
    const projectId = req.project?.id;

    // Get userId & username from the request body
    const userId = req.body.userId as string;
    const email = req.body.email as string;
    if (!userId && !email) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "Either User-ID or User-Email must be provided."
      );
    }

    // Find the user from the database
    const userFromDB = await User.findOne({
      ...(userId ? { _id: userId } : {}), // Include userId if its not-null
      ...(email ? { email } : {}), // Include email if its not-null
    }).select("-password -token -tokenExpiry -updatedAt -__v");
    if (!userFromDB) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "User with the provided details not found in the database."
      );
    }

    // Update the verification status
    userFromDB.isVerified = true;
    await userFromDB.save();

    // Send response
    res
      .status(200)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "User Verification-Status updated successfully.",
          {}
        )
      );
  }
);

// GET THE DASHBOARD METRICS ON THE ADMIN CONSOLE
export const dashboard = asyncHandler(async (req: IRequest, res: Response) => {
  // Admin-auth middleware: Authenticate the admin
  const adminId = req.admin?.id;

  // Get the projects created by the admin
  const projectsFromDB = await Project.find({ owner: adminId });

  // Create response-data
  const responseData = {
    projects: projectsFromDB,
  };

  // Send response
  res
    .status(responseType.SUCCESSFUL.code)
    .json(
      new ApiResponse(
        responseType.SUCCESSFUL.code,
        responseType.SUCCESSFUL.type,
        "Project Dashboard details fetched successfully.",
        responseData
      )
    );
});
