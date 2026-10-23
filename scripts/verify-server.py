#!/usr/bin/env python3
"""
Minimal SymPy-based math verification service.

Listens on 0.0.0.0:PORT (default 5001, override with PORT env var).
No external dependencies beyond sympy and its standard library (uses http.server).

Endpoint: POST /verify
Body (JSON):
  {
    "type": "equivalence" | "factoring" | "expansion" | "solving",
    "lhs": "<latex or sympy-parsable string>",
    "rhs": "<latex or sympy-parsable string>",
    "variable": "x"   // optional, default "x"
  }

Response (JSON):
  {
    "status": "VERIFIED" | "INCORRECT" | "UNCERTAIN" | "UNSUPPORTED",
    "note": "<human readable explanation>"
  }

All errors → UNCERTAIN (never crash, just say we couldn't check).
"""

import http.server
import json
import os
import sys
import traceback
from typing import Any

try:
    import sympy
    from sympy.parsing.latex import parse_latex
    from sympy import simplify, expand, factor, solve, symbols, Eq
    from sympy.core.sympify import SympifyError
    SYMPY_OK = True
except ImportError:
    SYMPY_OK = False


def parse_expr(text: str, var: str) -> Any:
    """Parse a LaTeX or SymPy string. Returns a SymPy expression or raises."""
    text = text.strip()
    x = symbols(var)
    # Try LaTeX first
    try:
        return parse_latex(text)
    except Exception:
        pass
    # Fall back to sympy.sympify (accepts Python-style expressions)
    try:
        return sympy.sympify(text, locals={var: x})
    except Exception:
        raise ValueError(f"Cannot parse: {text!r}")


def verify(req: dict) -> dict:
    if not SYMPY_OK:
        return {"status": "UNSUPPORTED", "note": "SymPy is not installed on this server."}

    vtype = req.get("type", "")
    lhs_str = req.get("lhs", "")
    rhs_str = req.get("rhs", "")
    var = req.get("variable", "x")

    if not lhs_str or not rhs_str:
        return {"status": "UNSUPPORTED", "note": "Missing lhs or rhs."}

    try:
        lhs = parse_expr(lhs_str, var)
        rhs = parse_expr(rhs_str, var)
    except Exception as e:
        return {"status": "UNCERTAIN", "note": f"Could not parse expressions: {e}"}

    try:
        if vtype == "equivalence":
            # Check lhs == rhs symbolically
            diff = simplify(lhs - rhs)
            if diff == 0:
                return {"status": "VERIFIED", "note": "The two expressions are symbolically equivalent."}
            return {"status": "INCORRECT", "note": f"Difference: {diff}"}

        elif vtype == "expansion":
            # Check that rhs is the expanded form of lhs
            expanded = expand(lhs)
            diff = simplify(expanded - rhs)
            if diff == 0:
                return {"status": "VERIFIED", "note": "Expansion is correct."}
            return {"status": "INCORRECT", "note": f"Expected expanded form: {expanded}"}

        elif vtype == "factoring":
            # Check that rhs is the factored form of lhs
            factored = factor(lhs)
            diff = simplify(expand(rhs) - lhs)
            if diff == 0:
                return {"status": "VERIFIED", "note": "Factoring is correct."}
            return {"status": "INCORRECT", "note": f"Factoring is incorrect. Got: {rhs}, expected factor of: {lhs}"}

        elif vtype == "solving":
            # lhs is the equation (e.g. "x^2+5x+6"), rhs is the proposed solution (e.g. "x=-2")
            x = symbols(var)
            # Evaluate lhs at rhs
            try:
                val = lhs.subs(x, rhs)
                if simplify(val) == 0:
                    return {"status": "VERIFIED", "note": f"{var}={rhs} satisfies the equation."}
                return {"status": "INCORRECT", "note": f"Substituting {var}={rhs} gives {simplify(val)}, not 0."}
            except Exception:
                return {"status": "UNCERTAIN", "note": "Could not evaluate substitution."}

        else:
            return {"status": "UNSUPPORTED", "note": f"Unknown verification type: {vtype!r}"}

    except Exception:
        return {"status": "UNCERTAIN", "note": f"Verification encountered an error: {traceback.format_exc(limit=3)}"}


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # silence request log
        pass

    def do_POST(self):
        if self.path != "/verify":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            req = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error":"invalid JSON"}')
            return
        result = verify(req)
        data = json.dumps(result).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            data = json.dumps({"ok": True, "sympy": SYMPY_OK}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    server = http.server.HTTPServer(("0.0.0.0", port), Handler)
    print(f"Math verification service listening on port {port} (sympy={'ok' if SYMPY_OK else 'NOT INSTALLED'})", flush=True)
    server.serve_forever()
