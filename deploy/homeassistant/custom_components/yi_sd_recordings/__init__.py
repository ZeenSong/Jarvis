"""Read Yi SD recordings on demand. No entities, recording copies or database."""
from __future__ import annotations
import asyncio
import json
import re
from datetime import datetime
from aiohttp import BasicAuth, ClientTimeout, web
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.auth.permissions.const import POLICY_READ

DOMAIN = "yi_sd_recordings"
DIR = re.compile(r"^\d{4}Y\d{2}M\d{2}D\d{2}H$")
FILE = re.compile(r"^\d{2}M\d{2}S\.mp4$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RANGE = re.compile(r"^bytes=(?:\d+-\d*|-\d+)$")
CONFIG_SCHEMA = vol.Schema({vol.Optional(DOMAIN): vol.Schema({})}, extra=vol.ALLOW_EXTRA)

def camera_config(hass, user, entity_id):
    if not user or not user.permissions.check_entity(entity_id, POLICY_READ):
        raise web.HTTPForbidden()
    entity = er.async_get(hass).async_get(entity_id)
    if not entity or entity.platform != "yi_hack" or not entity_id.startswith("camera."):
        raise web.HTTPNotFound()
    entry = hass.config_entries.async_get_entry(entity.config_entry_id)
    if not entry or entry.data.get("HACK_NAME") != "yi-hack-v5":
        raise web.HTTPNotFound()
    d = entry.data
    return f"http://{d['host']}:{int(d.get('port', 80))}", BasicAuth(d.get('username',''), d.get('password',''))

async def camera_json(hass, base, auth, path):
    # Serialise requests per camera: the small camera HTTP server is easily saturated.
    lock = hass.data[DOMAIN].setdefault(base, asyncio.Lock())
    async with lock:
        for attempt in range(2):
            try:
                async with async_get_clientsession(hass).get(base+path, auth=auth, allow_redirects=False, timeout=ClientTimeout(total=15)) as response:
                    response.raise_for_status()
                    data = bytearray()
                    async for chunk in response.content.iter_chunked(16384):
                        data.extend(chunk)
                        if len(data)>1024*1024:
                            raise ValueError("Camera index is too large")
                    return json.loads(data)
            except (TimeoutError, ValueError):
                if attempt: raise

async def async_setup(hass, config):
    hass.data[DOMAIN] = {}
    websocket_api.async_register_command(hass, recordings_index)
    hass.http.register_view(RecordingStream(hass))
    return True

@websocket_api.websocket_command({vol.Required('type'): 'yi_sd_recordings/index', vol.Required('entity_id'): str, vol.Optional('date'): str})
@websocket_api.async_response
async def recordings_index(hass, connection, msg):
    try:
        base, auth = camera_config(hass, connection.user, msg['entity_id'])
        dirs = await camera_json(hass, base, auth, '/cgi-bin/eventsdir.sh')
        names = sorted({x.get('dirname','') for x in dirs.get('records',[]) if DIR.fullmatch(x.get('dirname',''))}, reverse=True)
        dates = sorted({f'{x[:4]}-{x[5:7]}-{x[8:10]}' for x in names}, reverse=True)
        date = msg.get('date') or (dates[0] if dates else None)
        if date is not None and not DATE.fullmatch(date):
            raise ValueError('Invalid date')
        clips=[]
        failed=[]
        if date:
            datetime.strptime(date, '%Y-%m-%d')
            prefix=date[:4]+'Y'+date[5:7]+'M'+date[8:10]+'D'
            for directory in [x for x in names if x.startswith(prefix)][:24]:
                try:
                    records=await camera_json(hass,base,auth,'/cgi-bin/eventsfile.sh?dirname='+directory)
                except Exception:
                    failed.append(directory[11:13]);continue
                for item in records.get('records',[]):
                    filename=item.get('filename','')
                    if not FILE.fullmatch(filename):continue
                    stamp=f'{date}T{directory[11:13]}:{filename[:2]}:{filename[3:5]}'
                    try:datetime.fromisoformat(stamp)
                    except ValueError:continue
                    clips.append({'directory':directory,'filename':filename,'start':stamp,'path':f'/api/yi_sd_recordings/stream/{msg["entity_id"]}/{directory}/{filename}'})
        connection.send_result(msg['id'],{'dates':dates,'date':date,'clips':sorted(clips,key=lambda x:x['start']),'failed_hours':failed,'source':'camera_sd','event_index':'home_assistant_history'})
    except (web.HTTPForbidden,web.HTTPNotFound):
        connection.send_error(msg['id'],'not_allowed','Camera is unavailable or access is denied')
    except Exception:
        # Never put camera URLs or credentials into client errors.
        connection.send_error(msg['id'],'camera_unavailable','Unable to read the camera SD card. Retry when the camera is reachable.')

class RecordingStream(HomeAssistantView):
    url='/api/yi_sd_recordings/stream/{entity_id}/{directory}/{filename}'
    name='api:yi_sd_recordings:stream'
    requires_auth=True

    def __init__(self,hass):self.hass=hass

    async def get(self,request,entity_id,directory,filename):
        if not DIR.fullmatch(directory) or not FILE.fullmatch(filename):raise web.HTTPBadRequest()
        base,auth=camera_config(self.hass,request.get('hass_user'),entity_id)
        headers={}
        if value:=request.headers.get('Range'):
            if not RANGE.fullmatch(value):raise web.HTTPBadRequest()
            headers['Range']=value
        upstream=None
        response=None
        try:
            upstream=await async_get_clientsession(self.hass).get(base+'/record/'+directory+'/'+filename,auth=auth,headers=headers,allow_redirects=False,timeout=ClientTimeout(total=None,sock_connect=10,sock_read=30))
            if upstream.status not in (200,206,416):raise web.HTTPNotFound()
            forwarded={k:upstream.headers[k] for k in ('Content-Length','Content-Range','Accept-Ranges') if k in upstream.headers}
            # Camera's busybox httpd incorrectly labels MP4 as text/html.
            forwarded.update({'Content-Type':'video/mp4','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'})
            response=web.StreamResponse(status=upstream.status,headers=forwarded)
            await response.prepare(request)
            async for chunk in upstream.content.iter_chunked(65536):
                await response.write(chunk)
            await response.write_eof()
            return response
        except (ConnectionResetError,asyncio.CancelledError):
            if response is not None:return response
            raise
        except web.HTTPException:raise
        except Exception:
            if response is not None:
                response.force_close();return response
            raise web.HTTPBadGateway(text='Camera recording is temporarily unavailable') from None
        finally:
            if upstream is not None:upstream.close()
