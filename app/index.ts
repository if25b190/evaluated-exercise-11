import fastify, { FastifyRequest } from "fastify";
import { PrismaClient } from "@prisma/client";
import { isValidEmail } from "./services/isValidEmail";
import { PostHog } from "posthog-node";
import fastifyStatic from '@fastify/static';

const prisma = new PrismaClient();

const posthog = new PostHog(process.env.POSTHOG_API_KEY!, {
  host: process.env.POSTHOG_HOST,
  enableExceptionAutocapture: true,
});

function getDistinctId(request: FastifyRequest): string {
  const header = request.headers["X-POSTHOG-DISTINCT-ID"];
  if (typeof header === "string" && header) return header;
  return request.ip || "anonymous";
}

function getSessionId(request: FastifyRequest): string {
  const header = request.headers["X-POSTHOG-SESSION-ID"];
  if (typeof header === "string" && header) return header;
  return request.ip || "anonymous";
}

function trackPosthog(
  request: FastifyRequest,
  event: string,
  properties: Record<string | number, any> | undefined,
  sendFeatureFlags?: boolean,
) {
  posthog.capture({
    distinctId: getDistinctId(request),
    event: event,
    properties: {
      '$sessionId': getSessionId(request),
      ...properties
    },
    sendFeatureFlags: sendFeatureFlags,
  });
}

const server = fastify();

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "127.0.0.1";


// serve static files
// from the public folder
// at the root path "/"
server.register(fastifyStatic, {
  root: `${__dirname}/public`,
  prefix: '/',
});
/**
 * USERS CRUD
 */
// Get all users
server.get("/api/v1/users", async (_, reply) => {
  try {
    const users = await prisma.user.findMany();
    return reply.status(200).send({ users });
  } catch (error: any) {
    return reply.status(500).send({ error: error?.message });
  }
});

// Get single user by ID
server.get(
  "/api/v1/users/:id",
  async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      const { id } = request.params;
      const user = await prisma.user.findUnique({
        where: { id: Number(id) },
        include: {
          // If you want to also retrieve the user’s posts in one go:
          posts: true,
        },
      });

      return reply.status(200).send({ user });
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message });
    }
  },
);

// Create a user
server.post(
  "/api/v1/users",
  async (
    request: FastifyRequest<{
      Body: {
        name: string;
        email: string;
      };
    }>,
    reply,
  ) => {
    try {
      const { name, email } = request.body;

      const isEmailAValidEmail = isValidEmail(email);

      if (!isEmailAValidEmail) {
        trackPosthog(request, "user_creation_failed", {
          user_name: name,
          user_email: email,
        }, true);
        return reply.status(400).send({
          error: "Invalid email",
        });
      }

      const user = await prisma.user.create({
        data: {
          name,
          email,
        },
      });
      trackPosthog(request, "user_creation_success", {
        user_id: user.id,
        user_name: user.name,
        user_email: user.email,
      }, true);
      return reply.status(201).send({ user });
    } catch (error: any) {
      posthog.captureException(error, getDistinctId(request), { endpoint: 'POST /api/v1/users' });
      return reply.status(500).send({ error: error?.message });
    }
  },
);

// Update a user
server.put(
  "/api/v1/users/:id",
  async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        name?: string;
        email?: string;
      };
    }>,
    reply,
  ) => {
    try {
      const { id } = request.params;
      const { name, email } = request.body;

      const updatedUser = await prisma.user.update({
        where: { id: Number(id) },
        data: {
          ...(name && { name }),
          ...(email && { email }),
        },
      });

      return reply.status(200).send({ user: updatedUser });
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message });
    }
  },
);

// Delete a user
server.delete(
  "/api/v1/users/:id",
  async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      const { id } = request.params;

      const user = await prisma.user.delete({
        where: { id: Number(id) },
      });

      return reply.status(200).send({ user });
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message });
    }
  },
);

/**
 * POSTS CRUD
 */
// Get all posts
server.get("/api/v1/posts", async (_, reply) => {
  try {
    const posts = await prisma.post.findMany({
      include: {
        // If you want user data for each post
        user: true,
      },
    });
    return reply.status(200).send({ posts });
  } catch (error: any) {
    return reply.status(500).send({ error: error?.message });
  }
});

// Get single post by ID
server.get(
  "/api/v1/posts/:id",
  async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      const { id } = request.params;
      const post = await prisma.post.findUnique({
        where: { id: Number(id) },
        include: {
          user: true,
        },
      });

      return reply.status(200).send({ post });
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message });
    }
  },
);

// Create a post
server.post(
  "/api/v1/posts",
  async (
    request: FastifyRequest<{
      Body: {
        title: string;
        content?: string;
        userId: number;
      };
    }>,
    reply,
  ) => {
    try {
      const { title, content = "", userId } = request.body;

      if (!title || !userId) {
        trackPosthog(request, "post_creation_failed", {
          post_title: title,
          post_content: content,
          post_user: userId,
        });
        return reply.status(400).send({
          error: "title and userId are required",
        });
      }

      const post = await prisma.post.create({
        data: {
          title,
          content,
          user: {
            connect: {
              id: userId,
            },
          },
        },
      });
      trackPosthog(request, "post_creation_success", {
        post_id: post.id,
        post_title: post.title,
        post_content: post.content,
        post_user: post.userId,
      });
      return reply.status(201).send({ post });
    } catch (error: any) {
      posthog.captureException(error, getDistinctId(request), { endpoint: 'POST /api/v1/posts' });
      return reply.status(500).send({ error: error?.message });
    }
  },
);

// Update a post
server.put(
  "/api/v1/posts/:id",
  async (
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        title?: string;
        content?: string;
      };
    }>,
    reply,
  ) => {
    try {
      const { id } = request.params;
      const { title, content } = request.body;

      const updatedPost = await prisma.post.update({
        where: { id: Number(id) },
        data: {
          ...(title && { title }),
          ...(content && { content }),
        },
      });

      return reply.status(200).send({ post: updatedPost });
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message });
    }
  },
);

// Delete a post
server.delete(
  "/api/v1/posts/:id",
  async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      const { id } = request.params;
      const post = await prisma.post.delete({
        where: { id: Number(id) },
      });
      return reply.status(200).send({ post });
    } catch (error: any) {
      return reply.status(500).send({ error: error?.message });
    }
  },
);

process.on('SIGINT', async () => {
  await posthog.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await posthog.shutdown();
  process.exit(0);
});

// Start server
server.listen(
  {
    host: HOST,
    port: Number(PORT),
  },
  (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server listening at ${address}`);
  },
);
