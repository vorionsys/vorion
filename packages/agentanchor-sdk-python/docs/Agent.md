# Agent


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Unique agent identifier | [optional] 
**name** | **str** | Agent display name | [optional] 
**description** | **str** | Agent description | [optional] 
**status** | **str** | Current agent status | [optional] 
**trust_score** | **int** | Current trust score (0-1000) | [optional] 
**trust_tier** | **str** | Trust tier based on score | [optional] 
**certification_level** | **str** | Council certification level | [optional] 
**published** | **bool** | Whether agent is listed on marketplace | [optional] 
**capabilities** | **List[str]** | List of agent capabilities | [optional] 
**created_at** | **datetime** | Creation timestamp | [optional] 

## Example

```python
from agentanchor.models.agent import Agent

# TODO update the JSON string below
json = "{}"
# create an instance of Agent from a JSON string
agent_instance = Agent.from_json(json)
# print the JSON string representation of the object
print(Agent.to_json())

# convert the object into a dict
agent_dict = agent_instance.to_dict()
# create an instance of Agent from a dict
agent_from_dict = Agent.from_dict(agent_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


