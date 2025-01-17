import { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
import { IRequest } from "../types/types";
import { ApiError } from "../utils/custom-api-error";
import { env, responseType } from "../constants";
import { Project } from "../models/project.model";
import jwt from "jsonwebtoken";
import { ApiResponse } from "../utils/custom-api-response";
import {
  validateEmailTemplates,
  validateLoginMethods,
  validateProjectConfig,
  validateSecurityObject,
} from "../utils/project-config-validator";
import { User } from "../models/user.model";
import { Session } from "../models/session.model";
import { Log } from "../models/security-log.model";
import {
  EmailTemplateConfig,
  EmailTemplateName,
} from "../types/model-types/project.types";
import { ProjectLimit } from "../features/project-limit";
import { ZAppName, ZEmail, ZProjectName } from "../schema/zod.schema";

// SECURED ROUTE: CREATE NEW PROJECT
export const createProject = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-auth middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Get the project-details from the request-body
    const { projectName, config, appName, appEmail } = req.body;

    // Validate the project details-format sent over the request body
    if (!projectName.trim() || !appName.trim() || !appEmail.trim()) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "Please provide all the required details in the Request-body"
      );
    }
    if (!config) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Please provide a valid config details for the project"
      );
    }

    // Validate the project-name
    const isProjectNameValid = ZProjectName.safeParse(projectName);
    if (!isProjectNameValid.success) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Invalid Project-Name provided in the Request-body"
      );
    }

    // Validate the app-name
    const isAppNameValid = ZAppName.safeParse(appName);
    if (!isAppNameValid.success) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Invalid App-Name provided in the Request-body"
      );
    }

    // Validate the app-email
    const isAppEmailValid = ZEmail.safeParse(appEmail);
    if (!isAppEmailValid.success) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Invalid App-Email provided in the Request-body"
      );
    }

    // Validate the config object
    validateProjectConfig(config);

    // Check if a project with the same project-name exists in the database
    const projectFromDB = await Project.findOne({
      projectName,
      owner: adminId,
    }).select("-projectKey");
    if (projectFromDB) {
      throw new ApiError(
        responseType.ALREADY_EXISTS.code,
        responseType.ALREADY_EXISTS.type,
        "Project with the same name already exists. Provide a different name."
      );
    }

    // Create a new project (without the project-secret)
    const createdProject = await Project.create({
      projectName,
      owner: adminId,
      appName,
      appEmail,
      config,
      projectKey: `temporary-project-key-${Math.random()}`,
    });

    // Create a new projectKey for the project
    const projectKey = jwt.sign(
      {
        projectId: createdProject._id,
        owner: createdProject.owner,
      },
      env.secret.projectKeyGeneration
    );

    // Update the `projectKey` in the project document
    createdProject.projectKey = projectKey;
    await createdProject.save();

    // Send response with project data
    res
      .status(responseType.CREATED.code)
      .json(
        new ApiResponse(
          responseType.CREATED.code,
          responseType.CREATED.type,
          "New project created successfully",
          createdProject
        )
      );
  }
);

// SECURED ROUTE: CREATE A NEW PROJECT-KEY
export const createNewProjectKey = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-auth-middleware: Authenticate the admin

    // Validate-project middleware: Validate the project
    const projectId = req.project?.id;

    // Find the project document from the database
    const projectFromDB = await Project.findById(projectId);
    if (!projectFromDB) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "Project with the given Project-ID not found in the database"
      );
    }

    // Create a new projectKey for the project
    const projectKey = jwt.sign(
      {
        projectId: projectFromDB._id,
        owner: projectFromDB.owner,
      },
      env.secret.projectKeyGeneration
    );

    // Update the `projectKey` in the project document
    projectFromDB.projectKey = projectKey;
    await projectFromDB.save();

    // Send response with updated project data
    res
      .status(responseType.CREATED.code)
      .json(
        new ApiResponse(
          responseType.CREATED.code,
          responseType.CREATED.type,
          "New Project-Key created successfully",
          projectFromDB
        )
      );
  }
);

// SECURED ROUTE: GET A PROJECT (USING ITS PROJECT-ID) [no need to validate project]
export const getProject = asyncHandler(async (req: IRequest, res: Response) => {
  // Admin-auth middleware: Authenticate the admin

  // Get the project-ID from the request params
  const projectId = req.params["projectId"];
  if (!projectId) {
    throw new ApiError(
      responseType.INVALID_FORMAT.code,
      responseType.INVALID_FORMAT.type,
      "Project-ID not provided in Request Params"
    );
  }

  // Get the project document from the database
  const projectFromDB = await Project.findById(projectId);
  if (!projectFromDB) {
    throw new ApiError(
      responseType.NOT_FOUND.code,
      responseType.NOT_FOUND.type,
      "Project with the provided Project-ID not found in the database"
    );
  }

  // Send response with the project data
  res
    .status(responseType.SUCCESSFUL.code)
    .json(
      new ApiResponse(
        responseType.SUCCESSFUL.code,
        responseType.SUCCESSFUL.type,
        "Project details fetched successfully",
        projectFromDB
      )
    );
});

// SECURED ROUTE: UPDATE APP NAME
export const updateAppName = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-auth middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Project-validation middleware: Validate the project
    const projectId = req.project?.id;

    // Get the app-name from the request-body
    const { appName } = req.body;
    if (!appName) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "App-Name not provided in the Request-body"
      );
    }

    // Validate the project-name
    const isAppNameValid = ZAppName.safeParse(appName);
    if (!isAppNameValid.success) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Invalid App-Name provided in the Request-body",
        isAppNameValid.error.errors
      );
    }

    // Get the project document from the database
    const projectFromDB = await Project.findById(projectId);
    if (!projectFromDB) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "Project with the given Project-ID not found in the database"
      );
    }

    // Update the project document with the new app-name
    projectFromDB.appName = appName;
    await projectFromDB.save();

    // Send response with the updated project document data
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "App-Name updated successfully",
          projectFromDB
        )
      );
  }
);

// SECURED ROUTE: UPDATE APP EMAIL
export const updateAppEmail = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-auth middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Project-validation middleware: Validate the project
    const projectId = req.project?.id;

    // Get the app-email from the request-body
    const { appEmail } = req.body;
    if (!appEmail) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "App-Email not provided in the Request-body"
      );
    }

    // Validate the app-email format
    const isAppEmailValid = ZEmail.safeParse(appEmail);
    if (!isAppEmailValid.success) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Invalid App-Email provided in the Request-body",
        isAppEmailValid.error.errors
      );
    }

    // Get the project document from the database
    const projectFromDB = await Project.findById(projectId);
    if (!projectFromDB) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "Project with the given Project-ID not found in the database"
      );
    }

    // Update the project document with the new app-email
    projectFromDB.appEmail = appEmail;
    await projectFromDB.save();

    // Send response with the updated project document data
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "App-Email updated successfully",
          projectFromDB
        )
      );
  }
);

// SECURED ROUTE: UPDATE PROJECT LOGIN-METHODS SETTINGS
export const updateLoginMethods = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Authenticate the admin

    // Validate the project
    const projectId = req.project?.id;

    // Get the login-methods settings object from the request-body
    const { loginMethods } = req.body;
    if (!loginMethods) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Login-Methods object not found in the Request-body"
      );
    }
    if (Object.keys(loginMethods).length === 0) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Login-Methods object is empty. Please provide a valid object."
      );
    }

    // Validate the login-methods object
    validateLoginMethods(loginMethods);

    // Get the project document from the database
    const projectFromDB = await Project.findById(projectId);
    if (!projectFromDB) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "Project with the given Project-ID not found in the database"
      );
    }

    // Update the project document with the new login-methods settings
    projectFromDB.config.loginMethods = loginMethods;
    await projectFromDB.save();

    // Send response with update project document data
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "Login-Methods updated successfully",
          projectFromDB
        )
      );
  }
);

// SECURED ROUTE: UPDATE PROJECT SECURITY SETTINGS
export const updateSecurity = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Authenticate the admin

    // Validate the project
    const projectId = req.project?.id;

    // Get the security settings object from the request-body
    const { security } = req.body;
    if (!security) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Security object not found in the Request-body"
      );
    }
    if (Object.keys(security).length === 0) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Security object is empty. Please provide a valid object."
      );
    }

    // Validate the security object
    validateSecurityObject(security);

    // Get the project document from the database
    const projectFromDB = await Project.findById(projectId);
    if (!projectFromDB) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "Project with the given Project-ID not found in the database"
      );
    }

    // Update the project document with the new login-methods settings
    projectFromDB.config.security = security;
    await projectFromDB.save();

    // Send response with update project document data
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "Security settings updated successfully",
          projectFromDB
        )
      );
  }
);

// SECURED ROUTE: UPDATE PROJECT EMAIL-TEMPLATE SETTINGS
export const updateEmailTemplates = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Authenticate the admin

    // Validate the project
    const projectId = req.project?.id;

    // Get the Email-Templates settings object from the request-body
    const { emailTemplates } = req.body;
    if (!emailTemplates) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Email-Template object not found in the Request-body"
      );
    }
    if (Object.keys(emailTemplates).length === 0) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Email-Template object is empty. Please provide a valid object."
      );
    }

    // Validate the Email-Templates object
    validateEmailTemplates(emailTemplates);

    // Get the project document from the database
    const projectFromDB = await Project.findById(projectId);
    if (!projectFromDB) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "Project with the given Project-ID not found in the database"
      );
    }

    // Update the project document with the new login-methods settings
    projectFromDB.config.emailTemplates = emailTemplates;
    await projectFromDB.save();

    // Send response with update project document data
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "Email-Templates updated successfully",
          projectFromDB
        )
      );
  }
);

// SECURED ROUTE: DELETE A PROJECT (USING ITS PROJECT-ID) [no need to validate project]
export const deleteProject = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-auth middleware: Authenticate the admin

    // Get the projectId from the request-params
    const { projectId } = req.params;
    if (!projectId) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Valid Project-ID not found in the request parameters"
      );
    }

    // Find the project and delete it
    await Project.findByIdAndDelete(projectId);

    // Delete all the users corresponding to the project
    await User.deleteMany({ projectId });

    // Delete all the sessions corresponding to the project
    await Session.deleteMany({ projectId });

    // Delete all the logs corresponding to the project
    await Log.deleteMany({ projectId });

    // Send response
    res
      .status(responseType.DELETED.code)
      .json(
        new ApiResponse(
          responseType.DELETED.code,
          responseType.DELETED.type,
          "Project deleted successfully",
          {}
        )
      );
  }
);

// SECURED ROUTE: DELETE ALL CREATED PROJECTS [no need to validate project]
export const deleteAllProjects = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-auth middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Get all the projects created by the admin
    const allProjectIDs = await Project.aggregate([
      {
        $match: {
          owner: adminId,
        },
      },
      {
        $project: {
          _id: 1,
        },
      },
    ]);

    // Delete each project & the documents related to it
    allProjectIDs.forEach(async (item) => {
      const projectId = item._id;

      // Find the project and delete it
      await Project.findByIdAndDelete(projectId);

      // Delete all the users corresponding to the project
      await User.deleteMany({ projectId });

      // Delete all the sessions corresponding to the project
      await Session.deleteMany({ projectId });

      // Delete all the logs corresponding to the project
      await Log.deleteMany({ projectId });
    });

    // Send response
    res
      .status(responseType.DELETED.code)
      .json(
        new ApiResponse(
          responseType.DELETED.code,
          responseType.DELETED.type,
          "All projects deleted successfully",
          {}
        )
      );
  }
);

// SECURED ROUTE: GET ALL CREATED PROJECTS [no need to validate project]
export const getAllProjects = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-auth middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Find all the projects created by the admin
    const projectsFromDB = await Project.find({
      owner: adminId,
    });
    if (!projectsFromDB) {
      throw new ApiError(
        responseType.NOT_FOUND.code,
        responseType.NOT_FOUND.type,
        "No projects found in the database"
      );
    }

    // Send response
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "Projects fetched successfully",
          projectsFromDB
        )
      );
  }
);

// SECURED ROUTE: RESET A PARTICULAR EMAIL-TEMPLATE TO DEFAULT
export const resetEmailTemplateToDefault = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-auth middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Project-validation middleware: Validate the project
    const projectId = req.project?.id;

    // Get the EmailTemplate name from Request-Body
    const emailTemplate = req.params.emailTemplate;
    if (
      !Object.values(EmailTemplateName).includes(
        emailTemplate as EmailTemplateName
      )
    ) {
      throw new ApiError(
        responseType.INVALID_FORMAT.code,
        responseType.INVALID_FORMAT.type,
        "Email-Template provided in the Request-body is invalid."
      );
    }

    const projectFromDB = await Project.findById(projectId);
    const emailTemplatesObject = { ...projectFromDB?.config.emailTemplates };
    // Remove the particular emailTemplate property from the emailTemplates-object
    const {
      [emailTemplate as keyof EmailTemplateConfig]: _,
      ...updatedEmailTemplates
    } = emailTemplatesObject;
    // Update the Project-document
    projectFromDB!.config.emailTemplates = updatedEmailTemplates;
    await projectFromDB?.save();

    // Send response
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          `Email-Template: ${emailTemplate} reset to default successfully.`,
          {}
        )
      );
  }
);

// SECURED ROUTE: RESET SECURITY-SETTINGS TO DEFAULT
export const resetSecuritySettingToDefault = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-authentication middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Project-Validation middleware: Validate the project
    const projectId = req.project?.id;

    // Find the project in the database
    const projectFromDB = await Project.findById(projectId);
    projectFromDB!.config.security = {
      userLimit: 1000,
      userSessionLimit: 5,
    };
    await projectFromDB?.save();

    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "Security Settings reset successful",
          {}
        )
      );
  }
);

// SECURED ROUTE: GET THE PROJECT DETAILS IN THE PROJECT-OVERVIEW
export const projectOverview = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-auth middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Project-Validation middleware: Validate the project
    const projectId = req.project?.id;

    // Get the number of unique users enrolled in the project
    const uniqueUserCount = await User.countDocuments({
      projectId,
    });

    // Create response-data
    const responseData = {
      uniqueUserCount,
    };

    // Send response
    res
      .status(responseType.SUCCESSFUL.code)
      .json(
        new ApiResponse(
          responseType.SUCCESSFUL.code,
          responseType.SUCCESSFUL.type,
          "Project Overview details fetched successfully.",
          responseData
        )
      );
  }
);

// SECURED ROUTE: CLEAR ALL THE INACTIVE USER-ACCOUNTS IN A PROJECT
export const clearInactiveUserAccounts = asyncHandler(
  async (req: IRequest, res: Response) => {
    // Admin-auth middleware: Authenticate the admin
    const adminId = req.admin?.id;

    // Project-Validation middleware: Validate the project
    const projectId = req.project?.id;

    // Clear the inactive accounts
    const projectLimit = await ProjectLimit.create(projectId!);
    const deletedAccountCount = await projectLimit.clearInactiveUserAccounts();

    // Send response
    res.status(responseType.DELETED.code).json(
      new ApiResponse(
        responseType.DELETED.code,
        responseType.DELETED.type,
        `Inactive User-Accounts (with no activity in the last ${projectLimit.userActivityThreshold} days) deleted successfully`,
        {
          deletedItems: deletedAccountCount,
        }
      )
    );
  }
);
