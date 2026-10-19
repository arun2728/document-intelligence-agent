"""Lev on a free Hugging Face ZeroGPU Space, exposed as the Gradio API `/systemone`.

lib/lev.ts calls it when LEV_TRANSPORT=gradio.
"""

import json

import gradio as gr
import lev
import spaces
from peft import PeftModel

# PEFT reads adapter weights straight onto the inferred device, which ZeroGPU's
# startup CUDA emulation can't do ("No CUDA GPUs are available"). Read them on
# the CPU instead; PEFT then copies them into the emulated-CUDA LoRA layers.
_peft_from_pretrained = PeftModel.from_pretrained


def _from_pretrained_on_cpu(*args, **kwargs):
    kwargs.setdefault("torch_device", "cpu")
    return _peft_from_pretrained(*args, **kwargs)


PeftModel.from_pretrained = staticmethod(_from_pretrained_on_cpu)

# Load at import time: ZeroGPU emulates CUDA here and attaches a real GPU only
# inside @spaces.GPU, where placements made at startup are cheapest to restore.
model = lev.load("interfaze-ai/lev")


# One forward pass takes well under a second; a short duration keeps queue priority high.
@spaces.GPU(duration=30)
def systemone(state: str, questions: str) -> dict:
    """Answer Lev questions (a JSON object of choice/noul/score questions) about `state`."""
    return model.system_one(state, json.loads(questions)).model_dump()


gr.Interface(
    fn=systemone,
    inputs=[gr.Textbox(label="state", lines=8), gr.Code(label="questions (JSON)", language="json")],
    outputs=gr.JSON(label="answers"),
    api_name="systemone",
    title="Lev System One",
    flagging_mode="never",
).launch()
