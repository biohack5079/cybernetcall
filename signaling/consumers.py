import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)

user_uuid_to_channel = {}

class SignalingConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user_uuid = None
        await self.accept()
        logger.info(f"WebSocket connection accepted from {self.channel_name}")

    async def disconnect(self, close_code):
        logger.info(f"WebSocket connection closed for {self.channel_name} (UUID: {self.user_uuid}), code: {close_code}")
        if self.user_uuid and self.user_uuid in user_uuid_to_channel:
            if self.user_uuid in user_uuid_to_channel:
                del user_uuid_to_channel[self.user_uuid]
            logger.info(f"Removed user {self.user_uuid} from tracking.")

            await self.broadcast({
                'type': 'user_left',
                'uuid': self.user_uuid
            }, exclude_self=True)

    async def receive(self, text_data):
        try:
            message = json.loads(text_data)
            message_type = message.get('type')
            payload = message.get('payload', {})
            logger.debug(f"Received message type '{message_type}' from {self.channel_name} (UUID: {self.user_uuid})")

            if message_type == 'register':
                uuid_from_payload = payload.get('uuid')
                if uuid_from_payload:
                    if uuid_from_payload in user_uuid_to_channel and user_uuid_to_channel[uuid_from_payload] != self.channel_name:
                         logger.warning(f"UUID {uuid_from_payload} is already registered to a different channel {user_uuid_to_channel[uuid_from_payload]}. Overwriting with {self.channel_name}.")

                    self.user_uuid = uuid_from_payload
                    user_uuid_to_channel[self.user_uuid] = self.channel_name
                    logger.info(f"Registered user {self.user_uuid} to channel {self.channel_name}")

                    current_users = list(user_uuid_to_channel.keys())
                    await self.send(text_data=json.dumps({
                        'type': 'user_list',
                        'users': current_users
                    }))

                    await self.broadcast({
                        'type': 'user_joined',
                        'uuid': self.user_uuid
                    }, exclude_self=True)
                else:
                    logger.warning("Registration message received without UUID.")

            elif self.user_uuid:
                target_uuid = payload.get('target')
                if not target_uuid:
                    logger.warning(f"Received message type '{message_type}' without target from {self.user_uuid}. Ignoring.")
                    return
                target_channel_name = user_uuid_to_channel.get(target_uuid)

                if target_channel_name:
                    logger.debug(f"Forwarding message type '{message_type}' from {self.user_uuid} to {target_uuid} ({target_channel_name})")
                    # Add sender's UUID to the message before forwarding
                    forward_message = {
                        'type': message_type,
                        'payload': payload,
                        'from': self.user_uuid # Ensure 'from' is set for the recipient
                    }
                    await self.channel_layer.send(
                        target_channel_name,
                        {
                            'type': 'signal_message',
                            'message': forward_message
                        }
                    )
                else:
                     logger.warning(f"Target user {target_uuid} not found or not connected.")
            else:
                 logger.warning(f"Received message type '{message_type}' from unregistered channel {self.channel_name}. Ignoring.")

        except json.JSONDecodeError:
            logger.error(f"Could not decode JSON from {self.channel_name}: {text_data}")
        except Exception as e:
            logger.exception(f"Error processing message from {self.channel_name}: {e}")
            import traceback
            traceback.print_exc()

    async def signal_message(self, event):
        message = event['message']
        logger.debug(f"Sending signal message to {self.channel_name} (UUID: {self.user_uuid}): {message.get('type')}")
        await self.send(text_data=json.dumps(message))

    async def broadcast(self, message, exclude_self=True):
        logger.debug(f"Broadcasting message: {message}")
        for uuid, channel_name in user_uuid_to_channel.items():
            if exclude_self and uuid == self.user_uuid:
                continue
            try:
                await self.channel_layer.send(
                    channel_name,
                    {
                        'type': 'signal_message',
                        'message': message
                    }
                )
            except Exception as e:
                 logger.error(f"Error broadcasting to {uuid} ({channel_name}): {e}")
