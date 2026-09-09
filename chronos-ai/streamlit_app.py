import streamlit as st

from src.agent_engine import run_agent_query

st.set_page_config(page_title="Chronos", page_icon="🏎️")
st.title("🏎️ Chronos — F1 Strategy Agent")
st.markdown("Query live race telemetry and predictive models for pit strategy.")

query = st.text_input("Ask the race strategy agent:", "Should Driver 44 pit on lap 18?")

if st.button("Run Analysis"):
    with st.spinner("Querying telemetry and running the prediction model..."):
        try:
            result = run_agent_query(query)
        except RuntimeError as exc:
            st.error(str(exc))
        else:
            st.success("Strategy Decision:")
            st.write(result["answer"])
            if result["tool_calls"]:
                with st.expander("Tool calls made by the agent"):
                    st.json(result["tool_calls"])
