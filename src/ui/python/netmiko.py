"""Netmiko-compatible subset, running against the simulated network.

Connections are real in the simulation: the device must be reachable from the
PC running the script (TCP port 22, access lists and NAT apply), and configured
for SSH (hostname, ip domain-name, RSA keys, vty lines with login).
"""

import _sim

__all__ = [
    "ConnectHandler",
    "NetmikoBaseException",
    "NetmikoTimeoutException",
    "NetmikoAuthenticationException",
]

SUPPORTED = ("cisco_ios", "cisco_ios_ssh", "cisco_xe")


class NetmikoBaseException(Exception):
    pass


class NetmikoTimeoutException(NetmikoBaseException):
    pass


class NetmikoAuthenticationException(NetmikoBaseException):
    pass


class ConnectHandler:
    def __init__(self, device_type="cisco_ios", host=None, ip=None, username="", password="",
                 secret="", port=22, **kwargs):
        if device_type not in SUPPORTED:
            raise ValueError(
                f"Unsupported 'device_type' currently supported platforms are: {', '.join(SUPPORTED)}"
            )
        target = host or ip
        if not target:
            raise ValueError("Either 'ip' or 'host' must be set")
        if port != 22:
            raise NetmikoTimeoutException(f"TCP connection to device failed. Device {target}:{port} is not reachable.")
        result = _sim.connect(str(target), str(username), str(password))
        if result.error == "auth":
            raise NetmikoAuthenticationException(result.message)
        if result.error:
            raise NetmikoTimeoutException(result.message)
        self._sid = result.sid
        self.host = target
        self.secret = secret
        self.device_type = device_type

    # --- context manager -------------------------------------------------------
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.disconnect()
        return False

    # --- prompt and modes ----------------------------------------------------------
    def find_prompt(self):
        return _sim.prompt(self._sid)

    def check_enable_mode(self, check_string="#"):
        return self.find_prompt().endswith(check_string)

    def check_config_mode(self, check_string=")#"):
        return check_string in self.find_prompt()

    def enable(self, cmd="enable"):
        if self.check_enable_mode():
            return ""
        output = _sim.send(self._sid, cmd)
        if _sim.pending(self._sid) == "password":
            output += _sim.send(self._sid, self.secret)
        if not self.check_enable_mode():
            raise ValueError(
                "Failed to enter enable mode. Please ensure you pass the 'secret' argument to ConnectHandler."
            )
        return output

    def config_mode(self, config_command="configure terminal"):
        if self.check_config_mode():
            return ""
        if not self.check_enable_mode():
            raise ValueError("Failed to enter configuration mode: call enable() first.")
        return self._echo(config_command)

    def exit_config_mode(self, exit_config="end"):
        if not self.check_config_mode():
            return ""
        return self._echo(exit_config)

    # --- commands ------------------------------------------------------------------
    def send_command(self, command_string, **kwargs):
        """Runs one command and returns its output (without the prompt)."""
        return _sim.send(self._sid, str(command_string))

    def send_config_set(self, config_commands=None, exit_config_mode=True, **kwargs):
        """Enters configuration mode, runs every command, and returns the session transcript."""
        if config_commands is None:
            return ""
        if isinstance(config_commands, str):
            config_commands = [config_commands]
        output = self.config_mode()
        for command in config_commands:
            output += self._echo(str(command))
        if exit_config_mode:
            output += self.exit_config_mode()
        return output

    def send_multiline(self, commands, **kwargs):
        return "\n".join(self.send_command(c) for c in commands)

    def save_config(self, cmd="write memory", confirm=False, confirm_response=""):
        return self.send_command(cmd)

    def disconnect(self):
        if self._sid:
            _sim.close(self._sid)
            self._sid = 0

    def _echo(self, command):
        """Command as it appears in a terminal: prompt + command, then its output."""
        prompt = self.find_prompt()
        result = _sim.send(self._sid, command)
        return f"{prompt}{command}\n" + (f"{result}\n" if result else "")
