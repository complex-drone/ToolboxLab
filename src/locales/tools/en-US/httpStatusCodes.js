export default {
  title: 'HTTP Status Codes',
  description: 'Search and browse the meaning of common HTTP status codes from 1xx to 5xx',
  searchLabel: 'Search',
  searchPlaceholder: 'Enter a status code or keyword, e.g. 404, not found, redirect',
  expandHint: 'Click a card to expand or collapse the description',
  noMatch: 'No matching status codes, try another keyword',
  groups: {
    g1xx: 'Informational',
    g2xx: 'Success',
    g3xx: 'Redirection',
    g4xx: 'Client Error',
    g5xx: 'Server Error',
  },
  items: {
    s100: {
      name: 'Continue',
      desc: 'The server has received the request headers and the client should proceed to send the request body',
    },
    s101: {
      name: 'Switching Protocols',
      desc: 'The server agrees to switch protocols, commonly used for WebSocket upgrades',
    },
    s102: {
      name: 'Processing',
      desc: 'The server has received and is processing the request, but no final response is available yet (WebDAV)',
    },
    s103: {
      name: 'Early Hints',
      desc: 'Preliminary hints of resources to preload before the final response, used to improve load speed',
    },
    s200: {
      name: 'OK',
      desc: 'The request succeeded and the response body contains the expected result',
    },
    s201: {
      name: 'Created',
      desc: 'The request succeeded and a new resource was created, typically in response to POST',
    },
    s202: {
      name: 'Accepted',
      desc: 'The request has been accepted but not yet processed, suitable for asynchronous tasks',
    },
    s204: {
      name: 'No Content',
      desc: 'The request succeeded with an empty response body, common for delete or update actions',
    },
    s206: {
      name: 'Partial Content',
      desc: 'Only part of the resource is returned, used with the Range header for resumable downloads',
    },
    s301: {
      name: 'Moved Permanently',
      desc: 'The resource has permanently moved to a new URL and search engines transfer the ranking',
    },
    s302: {
      name: 'Found',
      desc: 'The resource temporarily resides at a different URL, future requests should still use the original one',
    },
    s303: {
      name: 'See Other',
      desc: 'The client should fetch the resource with GET at another URL, common after form submissions',
    },
    s304: {
      name: 'Not Modified',
      desc: 'The resource has not changed and the client can keep using its cached copy',
    },
    s307: {
      name: 'Temporary Redirect',
      desc: 'A temporary redirect that requires keeping the original request method and body unchanged',
    },
    s308: {
      name: 'Permanent Redirect',
      desc: 'A permanent redirect that requires keeping the original request method and body unchanged',
    },
    s400: {
      name: 'Bad Request',
      desc: 'The request is malformed or contains invalid parameters that the server cannot understand',
    },
    s401: {
      name: 'Unauthorized',
      desc: 'Authentication is required or has failed, valid credentials must be provided',
    },
    s403: {
      name: 'Forbidden',
      desc: 'The server understood the request but refuses to execute it, usually due to insufficient permissions',
    },
    s404: {
      name: 'Not Found',
      desc: 'The server cannot find the requested resource, the most common client error',
    },
    s405: {
      name: 'Method Not Allowed',
      desc: 'The request method is not supported by the resource, such as DELETE on a read-only endpoint',
    },
    s406: {
      name: 'Not Acceptable',
      desc: 'The resource cannot produce content matching the requirements of the Accept header',
    },
    s407: {
      name: 'Proxy Authentication Required',
      desc: 'The client must first authenticate itself with the proxy server',
    },
    s408: {
      name: 'Request Timeout',
      desc: 'The client did not complete the request within the time the server was prepared to wait',
    },
    s409: {
      name: 'Conflict',
      desc: 'The request conflicts with the current state of the resource, such as concurrent updates',
    },
    s410: {
      name: 'Gone',
      desc: 'The resource has been permanently removed and the URL should no longer be used, clearer than 404',
    },
    s411: {
      name: 'Length Required',
      desc: 'The request is missing the required Content-Length header',
    },
    s412: {
      name: 'Precondition Failed',
      desc: 'A precondition in the request headers, such as If-Match, was not met',
    },
    s413: {
      name: 'Payload Too Large',
      desc: 'The request body exceeds the maximum size the server is willing to accept',
    },
    s414: {
      name: 'URI Too Long',
      desc: 'The request URI is longer than the server is able to interpret',
    },
    s415: {
      name: 'Unsupported Media Type',
      desc: 'The media type of the request is not supported, such as uploading a wrong file format',
    },
    s416: {
      name: 'Range Not Satisfiable',
      desc: 'The requested Range is not satisfiable because it exceeds the actual size of the resource',
    },
    s417: {
      name: 'Expectation Failed',
      desc: 'The server cannot meet the expectation declared in the Expect request header',
    },
    s418: {
      name: "I'm a teapot",
      desc: 'An April Fools joke from 1998 (RFC 2324), the server refuses to brew coffee',
    },
    s422: {
      name: 'Unprocessable Entity',
      desc: 'The request is well-formed but semantically wrong and cannot be processed, common for validation failures',
    },
    s428: {
      name: 'Precondition Required',
      desc: 'The server requires conditional request headers to prevent lost updates',
    },
    s429: {
      name: 'Too Many Requests',
      desc: 'Too many requests in a given time, the client should retry later or follow the Retry-After header',
    },
    s431: {
      name: 'Request Header Fields Too Large',
      desc: 'The request header fields are too large, usually caused by oversized cookies or tokens',
    },
    s451: {
      name: 'Unavailable For Legal Reasons',
      desc: 'The resource is unavailable due to legal demands, common for copyright or censorship cases',
    },
    s500: {
      name: 'Internal Server Error',
      desc: 'The server encountered an unexpected internal error and failed to fulfill the request',
    },
    s501: {
      name: 'Not Implemented',
      desc: 'The server does not support the functionality required to fulfill the request',
    },
    s502: {
      name: 'Bad Gateway',
      desc: 'The gateway or proxy received an invalid response from the upstream server',
    },
    s503: {
      name: 'Service Unavailable',
      desc: 'The service is temporarily unavailable, usually due to overload or maintenance',
    },
    s504: {
      name: 'Gateway Timeout',
      desc: 'The gateway or proxy timed out while waiting for a response from the upstream server',
    },
    s505: {
      name: 'HTTP Version Not Supported',
      desc: 'The HTTP protocol version used in the request is not supported by the server',
    },
    s506: {
      name: 'Variant Also Negotiates',
      desc: 'Transparent content negotiation resulted in a circular configuration error',
    },
    s507: {
      name: 'Insufficient Storage',
      desc: 'The server has insufficient storage to complete the request (WebDAV)',
    },
    s508: {
      name: 'Loop Detected',
      desc: 'The server detected an infinite loop while processing the request (WebDAV)',
    },
    s511: {
      name: 'Network Authentication Required',
      desc: 'Network layer authentication is required before access, common on public Wi-Fi captive portals',
    },
  },
}
