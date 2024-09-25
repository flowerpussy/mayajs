const ErrorHandler = require("./errResponse.js");
const ResponseHandler = require("./responseHandler.js");

module.exports = async function handleRequest(socket, request, maya) {
  // Parsing the request
  const { method, path } = request;
  const [routerPath, queryString] = (path || "").split("?");
  const query = new URLSearchParams(queryString || "");
  request.query = Object.fromEntries(query.entries());
  // if  cors config is enabled then--->
  if (maya.corsConfig) {
    const res = await applyCors(request, ResponseHandler, maya.corsConfig);
    if (res) {
      socket.write(res);
      socket.end();
    }
  }

  const globalMiddlewares = await maya.middlewares["/"] || []

  const pathMiddlewares = request.path !== "/" ? 
  await maya.middlewares[request.path] || [] : [];

  const allMiddlewares = [...globalMiddlewares,...pathMiddlewares]
  // console.log(allMiddlewares)
  if (allMiddlewares.length > 0) {
    const res = await executeMiddleware(allMiddlewares, request, ResponseHandler);
  if (res && socket.writable) {
    socket.write(res);
  }
  }
  
  

  // find the Handler based on req path
  const routeHandler = maya.trie.search(routerPath,method);
  if (!routerPath || !routeHandler) {
    const res = ErrorHandler.RouteNotFoundError();
    socket.write(res);
    socket.end();
    return;
  }
  if (routeHandler?.method !== method) {
    const res = ErrorHandler.methodNotAllowedError();
    socket.write(res);
    socket.end();
    return;
  }

  let handler;
  let dynamicParams = {};

  if (routeHandler?.isDynamic) {
    dynamicParams = extractDynamicParams(routeHandler.path, path);
    if (dynamicParams) {
      request.params = dynamicParams;
      handler = routeHandler.handler;
    }
  } else if (routeHandler?.path === routerPath) {
    handler = routeHandler.handler;
  }

  // if we found handler then call the handler(means controller)
  if (handler) {
    try {
      const res = await handler(request, ResponseHandler, () => {});
      if (res) {
        socket.write(res);
      }
    } catch (error) {
      console.error("Error in handler:", error);
      return ErrorHandler.internalServerError();
    } finally {
      socket.end();
    }
  } else {
    return ErrorHandler.RouteNotFoundError();
  }
};

// if user made dynamic rooute -> /route/:id then extract it
const extractDynamicParams = (routePattern, path) => {
  const object = {};
  const routeSegments = routePattern.split("/");
  const [pathWithoutQuery] = path.split("?"); // Ignore the query string in the path
  const pathSegments = pathWithoutQuery.split("/"); // Re-split after removing query

  if (routeSegments.length !== pathSegments.length) {
    return null; // Path doesn't match the pattern
  }

  routeSegments.forEach((segment, index) => {
    if (segment.startsWith(":")) {
      const dynamicKey = segment.slice(1); // Remove ':' to get the key name
      object[dynamicKey] = pathSegments[index]; // Map the path segment to the key
    }
  });

  return object;
};

// we are applying cors here
const applyCors = (req, res, config = {}) => {
  const origin = req.headers["origin"];
  const allowedOrigins = config.origin || "*";
  const allowedMethods = config.methods || "GET,POST,PUT,DELETE,OPTIONS";
  const allowedHeaders = config.headers || ["Content-Type", "Authorization"];

  res.setHeader("Access-Control-Allow-Methods", allowedMethods);
  res.setHeader("Access-Control-Allow-Headers", allowedHeaders);

  if (!allowedOrigins.includes("*") || (!allowedOrigins === "*" && !allowedOrigins.includes(origin))) {
    return res.send("cors not allowed");
  }

  if (origin === "OPTIONS") {
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.send("", 204);
  }

  return null;
};

async function executeMiddleware(middlewares, req, res) {
  for(let i=0; i<middlewares.length;i++){
    const response = await middlewares[i](req,res,()=>{});
    if (response) {
      return response;
    }
  }
}

