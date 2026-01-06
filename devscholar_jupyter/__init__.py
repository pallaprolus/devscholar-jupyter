"""DevScholar JupyterLab Extension"""

try:
    from ._version import __version__
except ImportError:
    __version__ = "0.1.0"


def _jupyter_labextension_paths():
    """Return the paths to the JupyterLab extension."""
    return [{
        "src": "labextension",
        "dest": "devscholar-jupyter"
    }]
