"""Streamlit frontend application."""
import os
import streamlit as st
import requests
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime

# Configuration
API_URL = os.getenv("API_URL", "http://localhost:8000/api")

# Service URLs for production stack
MLFLOW_URL = os.getenv("MLFLOW_URL", "http://localhost:5000")
ARGILLA_URL = os.getenv("ARGILLA_URL", "http://localhost:6900")
PREFECT_URL = os.getenv("PREFECT_URL", "http://localhost:4200")
FLOWER_URL = os.getenv("FLOWER_URL", "http://localhost:5555")

st.set_page_config(
    page_title="Data Pipeline Tool",
    page_icon="🔄",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS
st.markdown("""
<style>
    .stProgress > div > div > div > div {
        background-color: #4CAF50;
    }
    .status-badge {
        padding: 4px 12px;
        border-radius: 12px;
        font-weight: bold;
        display: inline-block;
    }
    .status-pending { background-color: #FFC107; color: black; }
    .status-collecting { background-color: #2196F3; color: white; }
    .status-preprocessing { background-color: #9C27B0; color: white; }
    .status-validating { background-color: #FF9800; color: white; }
    .status-completed { background-color: #4CAF50; color: white; }
    .status-failed { background-color: #F44336; color: white; }
    .status-human_review { background-color: #E91E63; color: white; }
    .status-iterating { background-color: #00BCD4; color: white; }
</style>
""", unsafe_allow_html=True)


def get_status_badge(status: str) -> str:
    """Generate HTML badge for status."""
    return f'<span class="status-badge status-{status.lower()}">{status.upper()}</span>'


# --- API Helper Functions ---
def api_get(endpoint: str, params: dict = None):
    """Make GET request to API."""
    try:
        response = requests.get(f"{API_URL}{endpoint}", params=params)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        st.error(f"API Error: {str(e)}")
        return None


def api_post(endpoint: str, data: dict = None, files: dict = None, params: dict = None):
    """Make POST request to API."""
    try:
        if files:
            response = requests.post(f"{API_URL}{endpoint}", files=files, params=params)
        else:
            response = requests.post(f"{API_URL}{endpoint}", json=data, params=params)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        # Try to get detailed error message from response
        error_msg = str(e)
        try:
            if hasattr(e, 'response') and e.response is not None:
                error_detail = e.response.json().get('detail', str(e))
                error_msg = f"{error_msg} - {error_detail}"
        except:
            pass
        st.error(f"API Error: {error_msg}")
        return None


def api_put(endpoint: str, data: dict = None):
    """Make PUT request to API."""
    try:
        response = requests.put(f"{API_URL}{endpoint}", json=data)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        st.error(f"API Error: {str(e)}")
        return None


def api_delete(endpoint: str):
    """Make DELETE request to API."""
    try:
        response = requests.delete(f"{API_URL}{endpoint}")
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        st.error(f"API Error: {str(e)}")
        return None


# --- Sidebar Navigation ---
st.sidebar.title("🔄 Data Pipeline")
page = st.sidebar.radio(
    "Navigation",
    ["📊 Dashboard", "📁 Datasets", "⚙️ Pipeline Runs", "✅ Human Review", "📈 Analytics"]
)

st.sidebar.markdown("---")
st.sidebar.markdown("### Quick Stats")
stats = api_get("/stats")
if stats:
    st.sidebar.metric("Total Datasets", stats["total_datasets"])
    st.sidebar.metric("Total Records", stats["total_records"])
    st.sidebar.metric("Pipeline Runs", stats["total_runs"])
    if stats["pass_rate"]:
        st.sidebar.metric("Pass Rate", f"{stats['pass_rate']:.1%}")


# --- Page: Dashboard ---
if page == "📊 Dashboard":
    st.title("📊 Pipeline Dashboard")
    
    col1, col2, col3, col4 = st.columns(4)
    
    if stats:
        with col1:
            st.metric("Datasets", stats["total_datasets"])
        with col2:
            st.metric("Data Records", stats["total_records"])
        with col3:
            st.metric("Pipeline Runs", stats["total_runs"])
        with col4:
            pass_rate = stats["pass_rate"] or 0
            st.metric("Pass Rate", f"{pass_rate:.1%}")
    
    st.markdown("---")
    
    # Pipeline Flow Visualization
    st.subheader("🔄 Pipeline Flow")
    
    flow_col1, flow_col2, flow_col3, flow_col4, flow_col5 = st.columns(5)
    
    with flow_col1:
        st.markdown("### 1️⃣ Collection")
        st.info("Upload or input data")
    
    with flow_col2:
        st.markdown("### 2️⃣ Preprocess")
        st.info("Clean & normalize")
    
    with flow_col3:
        st.markdown("### 3️⃣ Inference")
        st.info("Model responses")
    
    with flow_col4:
        st.markdown("### 4️⃣ Validate")
        st.info("Metrics + Human")
    
    with flow_col5:
        st.markdown("### 5️⃣ Iterate")
        st.warning("If failed → Back to 1")
    
    st.markdown("---")
    
    # Recent Pipeline Runs
    st.subheader("🕐 Recent Pipeline Runs")
    runs = api_get("/pipeline/runs", {"limit": 10})
    
    if runs:
        for run in runs:
            with st.expander(f"Run #{run['id']} - Dataset {run['dataset_id']} - Iteration {run['iteration']}"):
                col1, col2, col3 = st.columns(3)
                with col1:
                    st.markdown(f"**Status:** {get_status_badge(run['status'])}", unsafe_allow_html=True)
                with col2:
                    st.markdown(f"**Started:** {run['started_at'][:19]}")
                with col3:
                    if run['completed_at']:
                        st.markdown(f"**Completed:** {run['completed_at'][:19]}")
                
                if run['error_message']:
                    st.error(run['error_message'])


# --- Page: Datasets ---
elif page == "📁 Datasets":
    st.title("📁 Dataset Management")
    
    tab1, tab2 = st.tabs(["📋 View Datasets", "➕ Create Dataset"])
    
    with tab1:
        datasets = api_get("/datasets")
        
        if datasets:
            for dataset in datasets:
                with st.expander(f"📂 {dataset['name']} ({dataset['record_count']} records)"):
                    st.markdown(f"**Description:** {dataset['description'] or 'No description'}")
                    st.markdown(f"**Source Type:** {dataset['source_type']}")
                    st.markdown(f"**Created:** {dataset['created_at'][:19]}")
                    
                    col1, col2, col3 = st.columns(3)
                    
                    with col1:
                        # Upload data file
                        uploaded_file = st.file_uploader(
                            "Upload data (CSV/JSON)",
                            type=["csv", "json"],
                            key=f"upload_{dataset['id']}"
                        )
                        if uploaded_file:
                            # Auto-convert option
                            auto_convert = st.checkbox(
                                "Auto-convert all columns to input_text (as JSON)",
                                value=True,
                                key=f"auto_convert_{dataset['id']}",
                                help="If checked, all columns will be combined into a JSON string for input_text"
                            )
                            if st.button(f"Upload to Dataset #{dataset['id']}", key=f"btn_upload_{dataset['id']}"):
                                # Reset file position and get content
                                uploaded_file.seek(0)
                                file_content = uploaded_file.read()
                                
                                # Determine content type
                                if uploaded_file.name.endswith('.csv'):
                                    content_type = 'text/csv'
                                else:
                                    content_type = 'application/json'
                                
                                files = {"file": (uploaded_file.name, file_content, content_type)}
                                result = api_post(
                                    f"/datasets/{dataset['id']}/upload",
                                    files=files,
                                    params={"auto_convert": str(auto_convert).lower()}
                                )
                                if result:
                                    st.success(result["message"])
                                    st.rerun()
                    
                    with col2:
                        # Start pipeline
                        if st.button(f"🚀 Run Pipeline", key=f"run_{dataset['id']}"):
                            result = api_post("/pipeline/run", {"dataset_id": dataset["id"]})
                            if result:
                                st.success(f"Pipeline started! Run ID: {result['id']}")
                    
                    with col3:
                        # Delete dataset
                        st.markdown("##### ⚠️ Danger Zone")
                        if st.button(f"🗑️ Delete Dataset", key=f"delete_{dataset['id']}", type="secondary"):
                            st.session_state[f"confirm_delete_{dataset['id']}"] = True
                        
                        if st.session_state.get(f"confirm_delete_{dataset['id']}", False):
                            st.warning("Are you sure? This will delete all records!")
                            col_yes, col_no = st.columns(2)
                            with col_yes:
                                if st.button("✓ Yes, Delete", key=f"confirm_yes_{dataset['id']}", type="primary"):
                                    result = api_delete(f"/datasets/{dataset['id']}")
                                    if result:
                                        st.success("Dataset deleted successfully!")
                                        st.session_state[f"confirm_delete_{dataset['id']}"] = False
                                        st.rerun()
                            with col_no:
                                if st.button("✗ Cancel", key=f"confirm_no_{dataset['id']}"):
                                    st.session_state[f"confirm_delete_{dataset['id']}"] = False
                                    st.rerun()
                    
                    # Show records with edit/delete options
                    st.markdown("#### Records")
                    records = api_get(f"/datasets/{dataset['id']}/records", {"limit": 20})
                    if records:
                        for record in records:
                            with st.container():
                                record_col1, record_col2 = st.columns([4, 1])
                                
                                with record_col1:
                                    # Check if editing this record
                                    edit_key = f"edit_record_{record['id']}"
                                    if st.session_state.get(edit_key, False):
                                        # Edit mode
                                        new_input = st.text_area(
                                            "Input Text",
                                            value=record['input_text'],
                                            key=f"input_{record['id']}"
                                        )
                                        new_expected = st.text_area(
                                            "Expected Output",
                                            value=record.get('expected_output', '') or '',
                                            key=f"expected_{record['id']}"
                                        )
                                        
                                        save_col, cancel_col = st.columns(2)
                                        with save_col:
                                            if st.button("💾 Save", key=f"save_{record['id']}"):
                                                result = api_put(f"/records/{record['id']}", {
                                                    "input_text": new_input,
                                                    "expected_output": new_expected if new_expected else None
                                                })
                                                if result:
                                                    st.success("Record updated!")
                                                    st.session_state[edit_key] = False
                                                    st.rerun()
                                        with cancel_col:
                                            if st.button("Cancel", key=f"cancel_{record['id']}"):
                                                st.session_state[edit_key] = False
                                                st.rerun()
                                    else:
                                        # View mode
                                        st.markdown(f"**#{record['id']}** - `{record['input_text'][:100]}{'...' if len(record['input_text']) > 100 else ''}`")
                                        if record.get('expected_output'):
                                            st.caption(f"Expected: {record['expected_output'][:50]}...")
                                
                                with record_col2:
                                    if not st.session_state.get(edit_key, False):
                                        btn_col1, btn_col2 = st.columns(2)
                                        with btn_col1:
                                            if st.button("✏️", key=f"edit_btn_{record['id']}", help="Edit record"):
                                                st.session_state[edit_key] = True
                                                st.rerun()
                                        with btn_col2:
                                            if st.button("🗑️", key=f"del_rec_{record['id']}", help="Delete record"):
                                                result = api_delete(f"/records/{record['id']}")
                                                if result:
                                                    st.success("Record deleted!")
                                                    st.rerun()
                                
                                st.divider()
                    else:
                        st.info("No records yet. Upload a file to add data.")
        else:
            st.info("No datasets found. Create one to get started!")
    
    with tab2:
        st.subheader("Create New Dataset")
        
        with st.form("create_dataset"):
            name = st.text_input("Dataset Name", placeholder="My Training Data")
            description = st.text_area("Description", placeholder="Description of the dataset...")
            source_type = st.selectbox("Source Type", ["upload", "api", "manual"])
            
            submitted = st.form_submit_button("Create Dataset")
            
            if submitted and name:
                result = api_post("/datasets", {
                    "name": name,
                    "description": description,
                    "source_type": source_type
                })
                if result:
                    st.success(f"Dataset '{name}' created successfully!")
                    st.rerun()


# --- Page: Pipeline Runs ---
elif page == "⚙️ Pipeline Runs":
    st.title("⚙️ Pipeline Runs")
    
    # Filters
    col1, col2 = st.columns(2)
    with col1:
        status_filter = st.selectbox(
            "Filter by Status",
            ["All", "pending", "collecting", "preprocessing", "validating", 
             "human_review", "completed", "failed", "iterating"]
        )
    
    # Get runs
    params = {"limit": 50}
    if status_filter != "All":
        params["status"] = status_filter
    
    runs = api_get("/pipeline/runs", params)
    
    if runs:
        for run in runs:
            status = run["status"]
            
            with st.expander(
                f"Run #{run['id']} | Dataset #{run['dataset_id']} | "
                f"Iteration {run['iteration']} | {status.upper()}"
            ):
                col1, col2, col3 = st.columns(3)
                
                with col1:
                    st.markdown(f"**Status:** {get_status_badge(status)}", unsafe_allow_html=True)
                    st.markdown(f"**Iteration:** {run['iteration']}")
                
                with col2:
                    st.markdown(f"**Started:** {run['started_at'][:19]}")
                    if run['completed_at']:
                        st.markdown(f"**Completed:** {run['completed_at'][:19]}")
                
                with col3:
                    if status == "failed":
                        if st.button(f"🔄 Retry (Iterate)", key=f"iterate_{run['id']}"):
                            result = api_post(f"/pipeline/runs/{run['id']}/iterate")
                            if result:
                                st.success(f"New iteration started! Run ID: {result['run_id']}")
                                st.rerun()
                
                if run['error_message']:
                    st.error(f"Error: {run['error_message']}")
                
                # Show validation summary
                summary = api_get(f"/pipeline/runs/{run['id']}/summary")
                if summary:
                    st.markdown("#### Validation Summary")
                    
                    metric_col1, metric_col2, metric_col3, metric_col4 = st.columns(4)
                    with metric_col1:
                        st.metric("Total", summary["total_validations"])
                    with metric_col2:
                        st.metric("Passed", summary["passed"], 
                                  delta_color="normal")
                    with metric_col3:
                        st.metric("Failed", summary["failed"],
                                  delta_color="inverse")
                    with metric_col4:
                        st.metric("Needs Review", summary["needs_review"])
                    
                    if summary["avg_accuracy"]:
                        st.progress(summary["avg_accuracy"], 
                                    text=f"Average Accuracy: {summary['avg_accuracy']:.2%}")
    else:
        st.info("No pipeline runs found.")


# --- Page: Human Review ---
elif page == "✅ Human Review":
    st.title("✅ Human Review Queue")
    
    # Get runs needing review
    runs = api_get("/pipeline/runs", {"status": "human_review"})
    
    if runs:
        for run in runs:
            st.subheader(f"Run #{run['id']} - Iteration {run['iteration']}")
            
            # Get validations needing review
            validations = api_get(f"/pipeline/runs/{run['id']}/validations", {"needs_review": True})
            
            if validations:
                for val in validations:
                    with st.expander(f"Validation #{val['id']} - Response #{val['model_response_id']}"):
                        col1, col2 = st.columns(2)
                        
                        with col1:
                            st.markdown("**Automated Scores:**")
                            if val['accuracy_score']:
                                st.metric("Accuracy", f"{val['accuracy_score']:.2%}")
                            if val['bleu_score']:
                                st.metric("BLEU", f"{val['bleu_score']:.2%}")
                            if val['rouge_score']:
                                st.metric("ROUGE", f"{val['rouge_score']:.2%}")
                        
                        with col2:
                            st.markdown("**Human Review:**")
                            
                            with st.form(f"review_{val['id']}"):
                                human_score = st.slider(
                                    "Quality Score",
                                    min_value=0.0,
                                    max_value=1.0,
                                    value=0.5,
                                    step=0.1
                                )
                                feedback = st.text_area("Feedback/Notes")
                                reviewer_id = st.text_input("Reviewer ID", value="reviewer_1")
                                
                                if st.form_submit_button("Submit Review"):
                                    result = api_post(f"/validations/{val['id']}/review", {
                                        "human_score": human_score,
                                        "human_feedback": feedback,
                                        "reviewer_id": reviewer_id
                                    })
                                    if result:
                                        st.success("Review submitted!")
                                        st.rerun()
            else:
                st.info("No validations pending review for this run.")
    else:
        st.success("🎉 No runs pending human review!")


# --- Page: Analytics ---
elif page == "📈 Analytics":
    st.title("📈 Analytics & Insights")
    
    # Quick links to external tools
    st.subheader("🔗 External Tools")
    tool_col1, tool_col2, tool_col3, tool_col4 = st.columns(4)
    
    with tool_col1:
        st.markdown(f"[![MLflow]({MLFLOW_URL})]({MLFLOW_URL})")
        st.markdown(f"[📊 MLflow Tracking]({MLFLOW_URL})")
    
    with tool_col2:
        st.markdown(f"[🏷️ Argilla Annotation]({ARGILLA_URL})")
    
    with tool_col3:
        st.markdown(f"[🔄 Prefect Workflows]({PREFECT_URL})")
    
    with tool_col4:
        st.markdown(f"[🌸 Flower (Celery)]({FLOWER_URL})")
    
    st.markdown("---")
    
    if stats:
        # Status distribution
        st.subheader("Pipeline Run Status Distribution")
        
        if stats["runs_by_status"]:
            status_df = pd.DataFrame([
                {"Status": k, "Count": v} 
                for k, v in stats["runs_by_status"].items()
            ])
            
            fig = px.pie(
                status_df, 
                values="Count", 
                names="Status",
                color="Status",
                color_discrete_map={
                    "completed": "#4CAF50",
                    "failed": "#F44336",
                    "pending": "#FFC107",
                    "human_review": "#E91E63",
                    "validating": "#FF9800",
                    "preprocessing": "#9C27B0",
                    "collecting": "#2196F3",
                    "iterating": "#00BCD4"
                }
            )
            st.plotly_chart(fig, use_container_width=True)
        
        st.markdown("---")
        
        # Validation scores over time
        st.subheader("Quality Metrics")
        
        col1, col2 = st.columns(2)
        
        with col1:
            if stats["avg_validation_score"]:
                fig = go.Figure(go.Indicator(
                    mode="gauge+number",
                    value=stats["avg_validation_score"] * 100,
                    title={"text": "Average Accuracy (%)"},
                    gauge={
                        "axis": {"range": [0, 100]},
                        "bar": {"color": "#4CAF50"},
                        "steps": [
                            {"range": [0, 50], "color": "#FFEBEE"},
                            {"range": [50, 80], "color": "#FFF3E0"},
                            {"range": [80, 100], "color": "#E8F5E9"}
                        ],
                        "threshold": {
                            "line": {"color": "red", "width": 4},
                            "thickness": 0.75,
                            "value": 80
                        }
                    }
                ))
                st.plotly_chart(fig, use_container_width=True)
        
        with col2:
            if stats["pass_rate"]:
                fig = go.Figure(go.Indicator(
                    mode="gauge+number",
                    value=stats["pass_rate"] * 100,
                    title={"text": "Pass Rate (%)"},
                    gauge={
                        "axis": {"range": [0, 100]},
                        "bar": {"color": "#2196F3"},
                        "steps": [
                            {"range": [0, 50], "color": "#FFEBEE"},
                            {"range": [50, 80], "color": "#FFF3E0"},
                            {"range": [80, 100], "color": "#E8F5E9"}
                        ],
                        "threshold": {
                            "line": {"color": "red", "width": 4},
                            "thickness": 0.75,
                            "value": 80
                        }
                    }
                ))
                st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("No data available for analytics yet.")


# --- Footer ---
st.sidebar.markdown("---")
st.sidebar.markdown("### 🔧 Service Status")

# API Status
try:
    response = requests.get(f"{API_URL}/stats", timeout=2)
    if response.status_code == 200:
        st.sidebar.success("✅ API Connected")
    else:
        st.sidebar.error("❌ API Error")
except:
    st.sidebar.error("❌ API Offline")

# MLflow Status
try:
    response = requests.get(f"{MLFLOW_URL}/health", timeout=2)
    st.sidebar.success("✅ MLflow")
except:
    st.sidebar.warning("⚠️ MLflow Offline")

# Argilla Status
try:
    response = requests.get(f"{ARGILLA_URL}/api/_status", timeout=2)
    st.sidebar.success("✅ Argilla")
except:
    st.sidebar.warning("⚠️ Argilla Offline")

# Prefect Status
try:
    response = requests.get(f"{PREFECT_URL}/api/health", timeout=2)
    st.sidebar.success("✅ Prefect")
except:
    st.sidebar.warning("⚠️ Prefect Offline")

st.sidebar.markdown("---")
st.sidebar.markdown("### 📚 Quick Links")
st.sidebar.markdown(f"- [API Docs]({API_URL.replace('/api', '/docs')})")
st.sidebar.markdown(f"- [MLflow]({MLFLOW_URL})")
st.sidebar.markdown(f"- [Argilla]({ARGILLA_URL})")
st.sidebar.markdown(f"- [Prefect]({PREFECT_URL})")
st.sidebar.markdown(f"- [Flower]({FLOWER_URL})")
