from slowapi import Limiter
from slowapi.util import get_remote_address


# Process-local limiter is a baseline protection; use a shared store such as
# Redis if CloudTune is ever deployed with multiple worker processes.
limiter = Limiter(key_func=get_remote_address, headers_enabled=True)
