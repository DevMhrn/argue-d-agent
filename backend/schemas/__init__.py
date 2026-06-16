"""Application schemas — Pydantic models that mirror the Supabase Postgres tables.

Use these for typed reads and writes from any backend module. They are separate
from the pipeline-internal models in `backend/app/types.py`, which describe
agent I/O shapes (Fact, EvidenceLedger, Decision, etc.). Some concepts overlap;
the application schemas are the storage-layer view, the app/types models are
the in-memory pipeline view.
"""
from .case import CaseRow, CaseCreate, CaseStatusUpdate, DEMO_TENANT_ID
from .document import (
    DocumentRow,
    DocumentCreate,
    DocumentStatusUpdate,
    DocumentStatus,
    StorageProvider,
)
from .document_page import DocumentPageRow, DocumentPageCreate
from .statute import StatuteRow, StatuteCreate
from .node import NodeRow, NodeCreate, NodeType
from .edge import EdgeRow, EdgeCreate, EdgeType
from .transcript import TranscriptRow, TranscriptCreate, PostingKind
from .decision import (
    DecisionRow,
    DecisionCreate,
    ConsensusType,
    FaultFavors,
    FaultTableRow,
)

__all__ = [
    "DEMO_TENANT_ID",
    "CaseRow",
    "CaseCreate",
    "CaseStatusUpdate",
    "DocumentRow",
    "DocumentCreate",
    "DocumentStatusUpdate",
    "DocumentStatus",
    "StorageProvider",
    "DocumentPageRow",
    "DocumentPageCreate",
    "StatuteRow",
    "StatuteCreate",
    "NodeRow",
    "NodeCreate",
    "NodeType",
    "EdgeRow",
    "EdgeCreate",
    "EdgeType",
    "TranscriptRow",
    "TranscriptCreate",
    "PostingKind",
    "DecisionRow",
    "DecisionCreate",
    "ConsensusType",
    "FaultFavors",
    "FaultTableRow",
]
