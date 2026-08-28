from .nodes import LoRATriggerStudio
from . import routes

NODE_CLASS_MAPPINGS = {"LoRATriggerStudio": LoRATriggerStudio}
NODE_DISPLAY_NAME_MAPPINGS = {"LoRATriggerStudio": "Kirei LoRA Trigger Studio"}
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
