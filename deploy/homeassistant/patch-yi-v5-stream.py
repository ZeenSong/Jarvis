"""Narrow local compatibility patch: yi-hack-v5 stream source and shared stills.
Run inside HA container after backing up camera.py. HACS updates can overwrite it.
"""
from pathlib import Path
p=Path('/config/custom_components/yi_hack/camera.py')
s=p.read_text()
marker='    # Quiet Home: yi-hack-v5 uses its verified RTSP endpoint and HA stream cache.'
if marker in s:
 print('Patch already applied');raise SystemExit
s=s.replace('import logging\n','import logging\nfrom urllib.parse import quote\n',1)
anchor='    async def stream_source(self) -> str:\n        """Return the stream source."""\n'
replacement='''    # Quiet Home: yi-hack-v5 uses its verified RTSP endpoint and HA stream cache.
    @property
    def use_stream_for_stills(self) -> bool:
        return self._hack_name == "yi-hack-v5"

    async def stream_source(self) -> str:
        """Return the stream source."""
        if self._hack_name == "yi-hack-v5":
            # snapshot.sh and links.sh can stall on the small v5 camera CPU.
            # Reuse HA's stream for stills instead of spawning camera-side grabbers.
            self.stream_options["rtsp_transport"] = "tcp"
            auth = ""
            if self._user or self._password:
                auth = f"{quote(self._user or '', safe='')}:{quote(self._password or '', safe='')}@"
            port = int(self._config_entry.data.get("RTSP_PORT", 554))
            return f"rtsp://{auth}{self._host}:{port}/ch0_0.h264"
'''
assert s.count(anchor)==1
p.write_text(s.replace(anchor,replacement,1));compile(p.read_text(),str(p),'exec');print('Applied yi-hack-v5 stream fix')
