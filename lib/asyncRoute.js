// Express 4 doesn't catch rejected promises from async route handlers on its own — an error
// thrown inside `async (req, res) => {...}` would otherwise just hang the request. Wrap any
// route handler that awaits the database in this so failures reach the error middleware instead.
function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncRoute };
